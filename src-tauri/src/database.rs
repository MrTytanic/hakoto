use std::{
    collections::{HashMap, hash_map::Entry},
    error::Error,
    fs, io,
    path::Path,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};

use crate::artwork;

const LEGACY_DATABASE_NAME: &str = "sleevy.db";
const INSERT_ALBUM: &str = "INSERT INTO albums
    (id, title, artist, format, release_year, artwork, favorite)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)";

pub fn initialize_database(
    app_dir: &Path,
    legacy_dir: Option<&Path>,
) -> Result<Connection, Box<dyn Error>> {
    let mut connection = Connection::open(app_dir.join("hakoto.db"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let already_initialized: bool = transaction.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'albums')",
        [],
        |row| row.get(0),
    )?;
    transaction.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS albums (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            format TEXT NOT NULL,
            release_year TEXT NOT NULL,
            artwork TEXT,
            favorite INTEGER NOT NULL DEFAULT 0
        );
        UPDATE albums SET artwork = NULL WHERE artwork GLOB 'blob:*';
        ",
    )?;

    // Commit the table and its imported rows together so a failed import can be retried.
    if !already_initialized && let Some(legacy_dir) = legacy_dir {
        import_legacy_albums(&transaction, app_dir, legacy_dir)?;
    }
    transaction.commit()?;
    Ok(connection)
}

fn import_legacy_albums(
    destination: &Connection,
    app_dir: &Path,
    legacy_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    let legacy_path = legacy_dir.join(LEGACY_DATABASE_NAME);
    if !legacy_path.try_exists()? {
        return Ok(());
    }

    let mut source = Connection::open_with_flags(legacy_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let snapshot = source.transaction()?;
    let mut imported_artwork = HashMap::new();
    for mut album in get_albums(&snapshot)? {
        if let Some(name) = album.artwork.take() {
            let migrated = match imported_artwork.entry(name) {
                Entry::Occupied(entry) => entry.into_mut(),
                Entry::Vacant(entry) => {
                    let filename = match artwork::read_checked(legacy_dir, entry.key()) {
                        Ok(bytes) => Some(store_artwork(destination, app_dir, &bytes)?),
                        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
                        Err(error) => return Err(error.into()),
                    };
                    entry.insert(filename)
                }
            };
            album.artwork = migrated.clone();
        }
        write_album(destination, INSERT_ALBUM, &album)?;
    }
    Ok(())
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub format: String,
    pub release_year: String,
    #[serde(skip_deserializing)]
    pub artwork: Option<String>,
    pub favorite: bool,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", content = "bytes", rename_all = "camelCase")]
pub enum ArtworkChange {
    Remove,
    Replace(Vec<u8>),
}

pub fn get_albums(connection: &Connection) -> rusqlite::Result<Vec<Album>> {
    let mut statement = connection.prepare(
        "SELECT id, title, artist, format, release_year, artwork, favorite
         FROM albums
         ORDER BY rowid ASC",
    )?;

    let albums = statement.query_map([], |row| {
        Ok(Album {
            id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            format: row.get(3)?,
            release_year: row.get(4)?,
            artwork: row
                .get::<_, Option<String>>(5)?
                .filter(|name| artwork::is_filename(name)),
            favorite: row.get(6)?,
        })
    })?;

    albums.collect()
}

pub fn save_album(
    connection: &mut Connection,
    app_dir: &Path,
    album: Album,
    bytes: Option<Vec<u8>>,
) -> Result<Album, String> {
    store_album(
        connection,
        app_dir,
        album,
        bytes.map(ArtworkChange::Replace),
        true,
    )
}

pub fn update_album(
    connection: &mut Connection,
    app_dir: &Path,
    album: Album,
    change: Option<ArtworkChange>,
) -> Result<Album, String> {
    store_album(connection, app_dir, album, change, false)
}

fn store_album(
    connection: &mut Connection,
    app_dir: &Path,
    mut album: Album,
    change: Option<ArtworkChange>,
    insert: bool,
) -> Result<Album, String> {
    // The writer lock also serializes startup cleanup with artwork writes in other app instances.
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let previous = if insert {
        None
    } else {
        album_artwork(&transaction, &album.id).map_err(|error| error.to_string())?
    };

    let mut new_file = None;
    album.artwork = match change {
        None => previous.clone(),
        Some(ArtworkChange::Remove) => None,
        Some(ArtworkChange::Replace(bytes)) => {
            let name =
                store_artwork(&transaction, app_dir, &bytes).map_err(|error| error.to_string())?;
            new_file = Some(name.clone());
            Some(name)
        }
    };

    let sql = if insert {
        INSERT_ALBUM
    } else {
        "UPDATE albums SET title = ?2, artist = ?3, format = ?4, release_year = ?5,
                           artwork = ?6, favorite = ?7 WHERE id = ?1"
    };
    let result = write_album(&transaction, sql, &album).and_then(|_| transaction.commit());

    if let Err(error) = result {
        // The transaction has rolled back. Check references even if commit reported an error.
        cleanup(connection, app_dir, new_file.as_deref());
        return Err(error.to_string());
    }
    if previous != album.artwork {
        cleanup(connection, app_dir, previous.as_deref());
    }
    Ok(album)
}

fn store_artwork(
    connection: &Connection,
    app_dir: &Path,
    bytes: &[u8],
) -> Result<String, Box<dyn Error>> {
    let name: String =
        connection.query_row("SELECT lower(hex(randomblob(16))) || '.webp'", [], |row| {
            row.get(0)
        })?;
    artwork::write(app_dir, &name, bytes)?;
    Ok(name)
}

fn write_album(connection: &Connection, sql: &str, album: &Album) -> rusqlite::Result<usize> {
    connection.execute(
        sql,
        params![
            album.id,
            album.title,
            album.artist,
            album.format,
            album.release_year,
            album.artwork,
            album.favorite,
        ],
    )
}

pub fn delete_album(
    connection: &mut Connection,
    app_dir: &Path,
    id: &str,
) -> Result<usize, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let Some(previous) = transaction
        .query_row("SELECT artwork FROM albums WHERE id = ?1", [id], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()
        .map_err(|error| error.to_string())?
    else {
        return Ok(0);
    };
    let rows = transaction
        .execute("DELETE FROM albums WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    cleanup(connection, app_dir, previous.as_deref());
    Ok(rows)
}

fn album_artwork(connection: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    connection.query_row("SELECT artwork FROM albums WHERE id = ?1", [id], |row| {
        row.get(0)
    })
}

fn cleanup(connection: &mut Connection, app_dir: &Path, name: Option<&str>) {
    let Some(name) = name.filter(|name| artwork::is_filename(name)) else {
        return;
    };

    let result = (|| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let directory = artwork::directory(app_dir).map_err(|error| error.to_string())?;
        remove_if_unreferenced(&transaction, &directory, name)?;
        transaction.commit().map_err(|error| error.to_string())
    })();

    if let Err(error) = result {
        eprintln!("Could not clean up artwork {name}: {error}");
    }
}

fn remove_if_unreferenced(
    connection: &Connection,
    directory: &Path,
    name: &str,
) -> Result<(), String> {
    let referenced: bool = connection
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM albums WHERE artwork = ?1)",
            [name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if !referenced
        && let Err(error) = fs::remove_file(directory.join(name))
        && error.kind() != io::ErrorKind::NotFound
    {
        return Err(error.to_string());
    }
    Ok(())
}

pub fn clean_orphaned_artwork(connection: &mut Connection, app_dir: &Path) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let directory = artwork::directory(app_dir).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if let Some(name) = entry
            .file_name()
            .to_str()
            .filter(|name| artwork::is_filename(name))
            && entry.file_type().is_ok_and(|kind| kind.is_file())
            && let Err(error) = remove_if_unreferenced(&transaction, &directory, name)
        {
            eprintln!("Could not clean up artwork {name}: {error}");
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // A 2 × 2 WebP image.
    const COVER: &[u8] = b"RIFF\x38\0\0\0WEBPVP8 \x2c\0\0\0\x90\x01\0\x9d\x01\x2a\x02\0\x02\0\x02\0\x34\x25\xa0\x02\x74\xba\0\x03\x98\0\xfe\xf9\x93\x6f\xff\x90\x1f\xff\x90\x1f\xff\x90\x1f\xff\x20\x3f\xe2\x17\x7b\x20\x30\0";

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let name: String = Connection::open_in_memory()
                .unwrap()
                .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
                .unwrap();
            let path = std::env::temp_dir().join(format!("hakoto-test-{name}"));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn album(id: &str) -> Album {
        Album {
            id: id.into(),
            title: "Title".into(),
            artist: "Artist".into(),
            format: "CD".into(),
            release_year: "1999".into(),
            artwork: None,
            favorite: false,
        }
    }

    #[test]
    fn renamed_app_imports_existing_collection_once_and_can_retry() {
        let legacy = TestDirectory::new();
        let current = TestDirectory::new();
        let mut source = initialize_database(&legacy.0, None).unwrap();
        let mut favorite = album("cover");
        favorite.favorite = true;
        let original = save_album(&mut source, &legacy.0, favorite, Some(COVER.to_vec()))
            .unwrap()
            .artwork
            .unwrap();
        save_album(&mut source, &legacy.0, album("plain"), None).unwrap();
        let legacy_database = legacy.0.join(LEGACY_DATABASE_NAME);
        source
            .execute("VACUUM INTO ?1", [legacy_database.to_str().unwrap()])
            .unwrap();
        drop(source);

        // A failed artwork write must leave the new database eligible for another import.
        let artwork_path = current.0.join("artwork");
        fs::write(&artwork_path, b"directory unavailable").unwrap();
        assert!(initialize_database(&current.0, Some(&legacy.0)).is_err());
        fs::remove_file(artwork_path).unwrap();

        let mut destination = initialize_database(&current.0, Some(&legacy.0)).unwrap();
        let albums = get_albums(&destination).unwrap();
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].id, "cover");
        assert_eq!(albums[0].release_year, "1999");
        assert!(albums[0].favorite);
        assert_eq!(
            artwork::read(&current.0, albums[0].artwork.as_deref().unwrap()).as_deref(),
            Some(COVER)
        );
        assert!(albums[1].artwork.is_none());
        assert_eq!(artwork::read(&legacy.0, &original).as_deref(), Some(COVER));
        assert!(legacy_database.is_file());

        delete_album(&mut destination, &current.0, "cover").unwrap();
        delete_album(&mut destination, &current.0, "plain").unwrap();
        drop(destination);
        let reopened = initialize_database(&current.0, Some(&legacy.0)).unwrap();
        assert!(get_albums(&reopened).unwrap().is_empty());
    }

    #[test]
    fn artwork_survives_reopening_and_is_cleaned_after_replacement_and_deletion() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        let original = save_album(&mut db, app_dir, album("cover"), Some(COVER.to_vec()))
            .unwrap()
            .artwork
            .unwrap();
        save_album(&mut db, app_dir, album("plain"), None).unwrap();
        db.execute(
            "UPDATE albums SET artwork = 'blob:legacy' WHERE id = 'plain'",
            [],
        )
        .unwrap();
        drop(db);

        let mut db = initialize_database(app_dir, None).unwrap();
        let albums = get_albums(&db).unwrap();
        assert_eq!(albums[0].artwork.as_deref(), Some(original.as_str()));
        assert_eq!(artwork::read(app_dir, &original).as_deref(), Some(COVER));
        assert!(albums[1].artwork.is_none());
        assert_eq!(albums[1].release_year, "1999");

        let mut favorite = album("cover");
        favorite.favorite = true;
        let favorite = update_album(&mut db, app_dir, favorite, None).unwrap();
        assert_eq!(favorite.artwork.as_deref(), Some(original.as_str()));
        assert!(get_albums(&db).unwrap()[0].favorite);

        // Simulate an existing shared reference.
        db.execute(
            "UPDATE albums SET artwork = ?1 WHERE id = 'plain'",
            [&original],
        )
        .unwrap();
        let replacement = update_album(
            &mut db,
            app_dir,
            favorite,
            Some(ArtworkChange::Replace(COVER.to_vec())),
        )
        .unwrap()
        .artwork
        .unwrap();
        assert_ne!(original, replacement);
        assert!(artwork::read(app_dir, &original).is_some());

        let removed = update_album(
            &mut db,
            app_dir,
            album("plain"),
            Some(ArtworkChange::Remove),
        )
        .unwrap();
        assert!(removed.artwork.is_none());
        assert!(artwork::read(app_dir, &original).is_none());
        assert_eq!(delete_album(&mut db, app_dir, "cover").unwrap(), 1);
        assert!(artwork::read(app_dir, &replacement).is_none());
        assert_eq!(get_albums(&db).unwrap().len(), 1);
    }

    #[test]
    fn failed_mutations_preserve_existing_artwork_and_remove_unreferenced_files() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        let original = save_album(&mut db, app_dir, album("cover"), Some(COVER.to_vec()))
            .unwrap()
            .artwork
            .unwrap();
        assert!(save_album(&mut db, app_dir, album("cover"), Some(COVER.to_vec())).is_err());

        db.execute_batch(
            "CREATE TRIGGER reject_update BEFORE UPDATE ON albums
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
             CREATE TRIGGER reject_delete BEFORE DELETE ON albums
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
        )
        .unwrap();
        assert!(
            update_album(
                &mut db,
                app_dir,
                album("cover"),
                Some(ArtworkChange::Replace(COVER.to_vec()))
            )
            .is_err()
        );
        assert!(delete_album(&mut db, app_dir, "cover").is_err());
        assert_eq!(fs::read_dir(app_dir.join("artwork")).unwrap().count(), 1);
        assert_eq!(
            get_albums(&db).unwrap()[0].artwork.as_deref(),
            Some(original.as_str())
        );

        let orphan = "0123456789abcdef0123456789abcdef.webp";
        artwork::write(app_dir, orphan, COVER).unwrap();
        clean_orphaned_artwork(&mut db, app_dir).unwrap();
        assert!(artwork::read(app_dir, orphan).is_none());
        assert!(artwork::read(app_dir, &original).is_some());
    }

    #[test]
    fn artwork_rejects_invalid_dimensions_payloads_and_paths() {
        let mut too_wide = COVER.to_vec();
        too_wide[26..28].copy_from_slice(&501u16.to_le_bytes());
        assert!(!artwork::validate(&too_wide));
        assert!(!artwork::validate(&COVER[..COVER.len() - 1]));
        assert!(!artwork::validate(&vec![0; 1024 * 1024 + 1]));
        let directory = TestDirectory::new();
        assert!(artwork::write(&directory.0, "../outside.webp", COVER).is_err());
        assert!(artwork::read(&directory.0, "../hakoto.db").is_none());
    }
}
