use std::{
    collections::{HashMap, hash_map::Entry},
    error::Error,
    fs, io,
    path::Path,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};

use crate::{artwork, profile, shelves};

const LEGACY_DATABASE_NAME: &str = "sleevy.db";
pub const DATABASE_NAME: &str = "hakoto.db";
pub(crate) const INSERT_ALBUM: &str = "INSERT INTO albums
    (id, title, artist, format, release_year, artwork, favorite, pinned, date_added, condition, record_type, disc_size)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)";

pub fn initialize_database(
    app_dir: &Path,
    legacy_dir: Option<&Path>,
) -> Result<Connection, Box<dyn Error>> {
    let mut connection = Connection::open(app_dir.join(DATABASE_NAME))?;
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
    migrate_album_columns(&transaction)?;
    profile::initialize(&transaction)?;

    // Commit the table and its imported rows together so a failed import can be retried.
    if !already_initialized && let Some(legacy_dir) = legacy_dir {
        import_legacy_albums(&transaction, app_dir, legacy_dir)?;
    }
    transaction.commit()?;
    shelves::migrate(&mut connection)?;
    Ok(connection)
}

fn has_album_metadata(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info('albums') WHERE name = 'pinned')",
        [],
        |row| row.get(0),
    )
}

pub(crate) fn migrate_album_columns(connection: &Connection) -> rusqlite::Result<()> {
    if !has_album_metadata(connection)? {
        connection.execute_batch(
            "ALTER TABLE albums ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE albums ADD COLUMN date_added TEXT;
             ALTER TABLE albums ADD COLUMN condition TEXT;
             ALTER TABLE albums ADD COLUMN record_type TEXT;
             ALTER TABLE albums ADD COLUMN disc_size TEXT;",
        )?;
    }
    crate::undo::initialize(connection)?;
    Ok(())
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
    #[serde(default)]
    pub pinned: bool,
    #[serde(skip_deserializing)]
    pub date_added: Option<String>,
    pub condition: Option<String>,
    pub record_type: Option<String>,
    pub disc_size: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", content = "bytes", rename_all = "camelCase")]
pub enum ArtworkChange {
    Remove,
    Replace(Vec<u8>),
}

pub fn get_albums(connection: &Connection) -> rusqlite::Result<Vec<Album>> {
    let metadata = if has_album_metadata(connection)? {
        "pinned, date_added, condition, record_type, disc_size"
    } else {
        "0, NULL, NULL, NULL, NULL"
    };
    let mut statement = connection.prepare(&format!(
        "SELECT id, title, artist, format, release_year, artwork, favorite, {metadata}
         FROM albums ORDER BY rowid ASC"
    ))?;

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
            pinned: row.get(7)?,
            date_added: row.get(8)?,
            condition: row.get(9)?,
            record_type: row.get(10)?,
            disc_size: row.get(11)?,
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

    album.date_added = if insert {
        transaction.query_row("SELECT date('now')", [], |row| row.get(0))
    } else {
        transaction.query_row(
            "SELECT date_added FROM albums WHERE id = ?1",
            [&album.id],
            |row| row.get(0),
        )
    }
    .map_err(|error| error.to_string())?;
    if !album.format.starts_with("Vinyl") {
        album.record_type = None;
        album.disc_size = None;
    }

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
                           artwork = ?6, favorite = ?7, pinned = ?8, date_added = ?9,
                           condition = ?10, record_type = ?11, disc_size = ?12 WHERE id = ?1"
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
    let name = image_filename(connection)?;
    artwork::write(app_dir, &name, bytes)?;
    Ok(name)
}

pub fn image_filename(connection: &Connection) -> rusqlite::Result<String> {
    connection.query_row("SELECT lower(hex(randomblob(16))) || '.webp'", [], |row| {
        row.get(0)
    })
}

pub(crate) fn write_album(
    connection: &Connection,
    sql: &str,
    album: &Album,
) -> rusqlite::Result<usize> {
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
            album.pinned,
            album.date_added,
            album.condition,
            album.record_type,
            album.disc_size,
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

pub(crate) fn cleanup(connection: &mut Connection, app_dir: &Path, name: Option<&str>) {
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
            "SELECT EXISTS (SELECT 1 FROM albums WHERE artwork = ?1 UNION ALL SELECT 1 FROM undo_albums WHERE artwork = ?1)",
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

    use crate::artwork::TEST_WEBP as COVER;

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
            pinned: false,
            date_added: None,
            condition: None,
            record_type: None,
            disc_size: None,
        }
    }

    #[test]
    fn recoverable_deletion_keeps_artwork_and_restores_metadata_and_placements_after_reopen() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let saved = save_album(&mut db, path, album("recover"), Some(COVER.to_vec())).unwrap();
        db.execute("INSERT INTO shelves (name, rows, columns, orientation) VALUES ('Shelf', 1, 2, 'vertical')", []).unwrap();
        db.execute(
            "INSERT INTO shelf_placements VALUES (1, 0, 0, 'recover')",
            [],
        )
        .unwrap();
        let token = crate::undo::delete(&mut db, "recover").unwrap();
        assert!(get_albums(&db).unwrap().is_empty());
        clean_orphaned_artwork(&mut db, path).unwrap();
        assert!(artwork::read(path, saved.artwork.as_deref().unwrap()).is_some());
        drop(db);
        let mut db = initialize_database(path, None).unwrap();
        assert_eq!(crate::undo::pending(&db).unwrap().len(), 1);
        let restored = crate::undo::restore(&mut db, path, &token).unwrap();
        assert_eq!(
            serde_json::to_value(saved).unwrap(),
            serde_json::to_value(restored).unwrap()
        );
        assert_eq!(shelves::load_shelf(&mut db, 1).unwrap().placements.len(), 1);
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert!(crate::undo::pending(&db).unwrap().is_empty());
        let name = get_albums(&db).unwrap()[0].artwork.clone().unwrap();
        save_album(&mut db, path, album("shared"), None).unwrap();
        db.execute(
            "UPDATE albums SET artwork = ?1 WHERE id = 'shared'",
            [&name],
        )
        .unwrap();
        let token = crate::undo::delete(&mut db, "recover").unwrap();
        crate::undo::discard(&mut db, path, &token).unwrap();
        assert!(artwork::read(path, &name).is_some());
        delete_album(&mut db, path, "shared").unwrap();
        assert_eq!(fs::read_dir(path.join("artwork")).unwrap().count(), 0);
    }

    #[test]
    fn failed_deletion_and_conflicting_or_missing_artwork_restores_roll_back() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let saved = save_album(&mut db, path, album("recover"), Some(COVER.to_vec())).unwrap();
        db.execute_batch("CREATE TRIGGER block_delete BEFORE DELETE ON albums BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
        assert!(crate::undo::delete(&mut db, "recover").is_err());
        assert!(crate::undo::pending(&db).unwrap().is_empty());
        assert_eq!(get_albums(&db).unwrap().len(), 1);
        db.execute_batch("DROP TRIGGER block_delete; INSERT INTO shelves (name, rows, columns, orientation) VALUES ('Shelf', 1, 1, 'vertical'); INSERT INTO shelf_placements VALUES (1, 0, 0, 'recover');").unwrap();
        let token = crate::undo::delete(&mut db, "recover").unwrap();
        save_album(&mut db, path, album("other"), None).unwrap();
        db.execute("INSERT INTO shelf_placements VALUES (1, 0, 0, 'other')", [])
            .unwrap();
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert_eq!(get_albums(&db).unwrap().len(), 1);
        assert_eq!(crate::undo::pending(&db).unwrap().len(), 1);
        db.execute("DELETE FROM shelf_placements", []).unwrap();
        let name = saved.artwork.unwrap();
        fs::remove_file(path.join("artwork").join(&name)).unwrap();
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert_eq!(get_albums(&db).unwrap().len(), 1);
        artwork::write(path, &name, COVER).unwrap();
        crate::undo::restore(&mut db, path, &token).unwrap();
        let token = crate::undo::delete(&mut db, "recover").unwrap();
        db.execute(
            "UPDATE undo_albums SET expires = 0 WHERE token = ?1",
            [&token],
        )
        .unwrap();
        crate::undo::purge_expired(&mut db, path).unwrap();
        assert!(crate::undo::pending(&db).unwrap().is_empty());
        assert!(artwork::read(path, &name).is_none());
    }

    #[test]
    fn profile_is_added_to_existing_collections_and_survives_reopening() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        save_album(&mut db, app_dir, album("existing"), None).unwrap();
        db.execute("DROP TABLE profile", []).unwrap();
        drop(db);

        let mut db = initialize_database(app_dir, None).unwrap();
        let default = profile::get(&db).unwrap();
        assert_eq!(default.display_name, "");
        assert!(default.profile_picture.is_none());
        profile::set_display_name(&db, "Zoë 🎵").unwrap();
        let picture =
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
                .unwrap()
                .unwrap();
        assert!(artwork::is_filename(&picture));
        assert!(app_dir.join("profile-images").join(&picture).is_file());
        assert!(!app_dir.join("artwork").exists());
        drop(db);

        let db = initialize_database(app_dir, None).unwrap();
        let saved = profile::get(&db).unwrap();
        assert_eq!(saved.display_name, "Zoë 🎵");
        assert_eq!(saved.profile_picture.as_deref(), Some(picture.as_str()));
        assert_eq!(
            profile::read_image(app_dir, &picture).as_deref(),
            Some(COVER)
        );
        let storage_type: String = db
            .query_row("SELECT typeof(picture) FROM profile", [], |row| row.get(0))
            .unwrap();
        assert_eq!(storage_type, "text");
        assert_eq!(get_albums(&db).unwrap()[0].id, "existing");
    }

    #[test]
    fn profile_replacement_removal_and_startup_cleanup_only_touch_profile_images() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        let original =
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
                .unwrap()
                .unwrap();
        artwork::write(app_dir, &original, COVER).unwrap();
        let replacement =
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
                .unwrap()
                .unwrap();
        assert_ne!(replacement, original);
        assert!(!app_dir.join("profile-images").join(&original).exists());
        assert_eq!(
            profile::read_image(app_dir, &replacement).as_deref(),
            Some(COVER)
        );

        // Simulate a file left behind by an interrupted update.
        let orphan = app_dir.join("profile-images").join(&original);
        fs::write(&orphan, COVER).unwrap();
        drop(db);
        let mut db = initialize_database(app_dir, None).unwrap();
        profile::clean_orphaned_images(&mut db, app_dir).unwrap();
        assert!(!orphan.exists());
        assert_eq!(
            profile::read_image(app_dir, &replacement).as_deref(),
            Some(COVER)
        );

        profile::set_display_name(&db, "Saved name").unwrap();
        assert_eq!(
            profile::set_picture(&mut db, app_dir, ArtworkChange::Remove).unwrap(),
            None
        );
        assert!(!app_dir.join("profile-images").join(replacement).exists());
        assert_eq!(artwork::read(app_dir, &original).as_deref(), Some(COVER));
        drop(db);
        let db = initialize_database(app_dir, None).unwrap();
        let saved = profile::get(&db).unwrap();
        assert_eq!(saved.display_name, "Saved name");
        assert!(saved.profile_picture.is_none());
    }

    #[test]
    fn failed_profile_writes_preserve_committed_data_and_clean_new_files() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        profile::set_display_name(&db, "Saved name").unwrap();
        let original =
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
                .unwrap()
                .unwrap();
        assert!(profile::set_display_name(&db, &"x".repeat(41)).is_err());
        assert!(
            profile::set_picture(
                &mut db,
                app_dir,
                ArtworkChange::Replace(b"not an image".to_vec())
            )
            .is_err()
        );

        let images = app_dir.join("profile-images");
        let backup = app_dir.join("images-backup");
        fs::rename(&images, &backup).unwrap();
        fs::write(&images, b"directory unavailable").unwrap();
        assert!(
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec())).is_err()
        );
        fs::remove_file(&images).unwrap();
        fs::rename(backup, &images).unwrap();

        db.execute_batch(
            "CREATE TRIGGER reject_profile_update BEFORE UPDATE ON profile
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
        )
        .unwrap();
        assert!(profile::set_display_name(&db, "Failed name").is_err());
        assert!(
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec())).is_err()
        );
        assert!(profile::set_picture(&mut db, app_dir, ArtworkChange::Remove).is_err());
        drop(db);

        let db = initialize_database(app_dir, None).unwrap();
        let saved = profile::get(&db).unwrap();
        assert_eq!(saved.display_name, "Saved name");
        assert_eq!(saved.profile_picture.as_deref(), Some(original.as_str()));
        assert_eq!(
            profile::read_image(app_dir, &original).as_deref(),
            Some(COVER)
        );
        assert_eq!(fs::read_dir(images).unwrap().count(), 1);
    }

    #[test]
    fn missing_or_unsafe_profile_picture_does_not_prevent_loading_or_repair() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        profile::set_display_name(&db, "Saved name").unwrap();
        let name = profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
            .unwrap()
            .unwrap();
        fs::remove_file(app_dir.join("profile-images").join(&name)).unwrap();
        assert!(profile::read_image(app_dir, &name).is_none());
        assert_eq!(
            profile::get(&db).unwrap().profile_picture.as_deref(),
            Some(name.as_str())
        );

        fs::write(app_dir.join(&name), COVER).unwrap();
        let traversal = format!("../{name}");
        db.execute("UPDATE profile SET picture = ?1", [&traversal])
            .unwrap();
        assert!(profile::read_image(app_dir, &traversal).is_none());
        assert!(profile::get(&db).unwrap().profile_picture.is_none());
        let repaired =
            profile::set_picture(&mut db, app_dir, ArtworkChange::Replace(COVER.to_vec()))
                .unwrap()
                .unwrap();
        assert_eq!(
            profile::read_image(app_dir, &repaired).as_deref(),
            Some(COVER)
        );
        assert_eq!(fs::read(app_dir.join(name)).unwrap(), COVER);
        assert_eq!(profile::get(&db).unwrap().display_name, "Saved name");
    }

    #[test]
    fn initialization_creates_schema_and_preserves_rows_on_repeat() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let db = initialize_database(app_dir, None).unwrap();
        assert!(app_dir.join("hakoto.db").is_file());
        assert!(get_albums(&db).unwrap().is_empty());

        // Omit the optional columns to exercise the schema defaults.
        db.execute(
            "INSERT INTO albums (id, title, artist, format, release_year)
             VALUES ('album', 'Title', 'Artist', 'CD', '1999')",
            [],
        )
        .unwrap();
        drop(db);

        let db = initialize_database(app_dir, None).unwrap();
        let albums = get_albums(&db).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].id, "album");
        assert!(!albums[0].favorite);
        assert!(albums[0].artwork.is_none());
    }

    #[test]
    fn migrates_album_metadata_without_inventing_dates_for_existing_albums() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let old = Connection::open(app_dir.join(DATABASE_NAME)).unwrap();
        old.execute_batch(
            "CREATE TABLE albums (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
                format TEXT NOT NULL, release_year TEXT NOT NULL, artwork TEXT,
                favorite INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO albums VALUES ('old', 'Title', 'Artist', 'CD', '', NULL, 1);",
        )
        .unwrap();
        drop(old);

        let db = initialize_database(app_dir, None).unwrap();
        let saved = get_albums(&db).unwrap().pop().unwrap();
        assert_eq!(saved.id, "old");
        assert_eq!(saved.title, "Title");
        assert!(saved.favorite);
        assert!(!saved.pinned);
        assert!(saved.date_added.is_none());
        assert!(saved.condition.is_none());
        assert!(saved.release_year.is_empty());
    }

    #[test]
    fn album_metadata_favorite_and_deletion_persist_across_reopens() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        save_album(&mut db, app_dir, album("album"), None).unwrap();
        let mut saved = get_albums(&db).unwrap().pop().unwrap();
        assert_eq!(saved.title, "Title");
        assert!(!saved.favorite);
        let date_added = saved.date_added.clone().unwrap();
        assert_eq!(date_added.len(), 10);

        saved.title = "Updated title".into();
        saved.artist = "Updated artist".into();
        saved.format = "Vinyl".into();
        saved.release_year = "2001".into();
        saved.favorite = true;
        saved.pinned = true;
        saved.condition = Some("Near Mint".into());
        saved.record_type = Some("EP".into());
        saved.disc_size = Some("10".into());
        saved.date_added = None;
        update_album(&mut db, app_dir, saved, None).unwrap();
        drop(db);

        let mut db = initialize_database(app_dir, None).unwrap();
        let albums = get_albums(&db).unwrap();
        assert!(albums[0].pinned);
        assert_eq!(albums[0].date_added.as_deref(), Some(date_added.as_str()));
        assert_eq!(albums[0].condition.as_deref(), Some("Near Mint"));
        assert_eq!(albums[0].record_type.as_deref(), Some("EP"));
        assert_eq!(albums[0].disc_size.as_deref(), Some("10"));
        assert_eq!(albums.len(), 1);
        let updated = &albums[0];
        assert_eq!(updated.id, "album");
        assert_eq!(updated.title, "Updated title");
        assert_eq!(updated.artist, "Updated artist");
        assert_eq!(updated.format, "Vinyl");
        assert_eq!(updated.release_year, "2001");
        assert!(updated.favorite);
        assert_eq!(delete_album(&mut db, app_dir, "album").unwrap(), 1);
        drop(db);

        let db = initialize_database(app_dir, None).unwrap();
        assert!(get_albums(&db).unwrap().is_empty());
    }

    #[test]
    fn invalid_album_operations_leave_the_collection_unchanged() {
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        assert!(initialize_database(&app_dir.join("missing"), None).is_err());
        let mut db = initialize_database(app_dir, None).unwrap();
        save_album(&mut db, app_dir, album("album"), None).unwrap();

        let mut duplicate = album("album");
        duplicate.title = "Duplicate".into();
        assert!(save_album(&mut db, app_dir, duplicate, None).is_err());
        assert!(
            update_album(
                &mut db,
                app_dir,
                album("missing"),
                Some(ArtworkChange::Replace(COVER.to_vec())),
            )
            .is_err()
        );
        assert_eq!(delete_album(&mut db, app_dir, "missing").unwrap(), 0);
        let albums = get_albums(&db).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].id, "album");
        assert_eq!(albums[0].title, "Title");
        assert!(!app_dir.join("artwork").exists());
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
        save_album(&mut source, &legacy.0, album("missing"), None).unwrap();
        source
            .execute(
                "UPDATE albums SET artwork = '0123456789abcdef0123456789abcdef.webp'
                 WHERE id = 'missing'",
                [],
            )
            .unwrap();
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
        assert_eq!(albums[1].id, "missing");
        assert!(albums[1].artwork.is_none());
        assert_eq!(artwork::read(&legacy.0, &original).as_deref(), Some(COVER));
        assert!(legacy_database.is_file());

        delete_album(&mut destination, &current.0, "cover").unwrap();
        delete_album(&mut destination, &current.0, "missing").unwrap();
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
        let stored = album_artwork(&db, "cover").unwrap().unwrap();
        assert_eq!(stored, original);
        assert!(artwork::is_filename(&stored));
        assert!(Path::new(&stored).is_relative());
        assert_eq!(
            fs::read(app_dir.join("artwork").join(&stored)).unwrap(),
            COVER
        );
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
        assert_eq!(album_artwork(&db, "plain").unwrap(), None);
        assert_eq!(albums[1].release_year, "1999");

        let mut favorite = album("cover");
        favorite.title = "Renamed album".into();
        favorite.favorite = true;
        let favorite = update_album(&mut db, app_dir, favorite, None).unwrap();
        assert_eq!(favorite.artwork.as_deref(), Some(original.as_str()));
        let albums = get_albums(&db).unwrap();
        assert_eq!(albums[0].title, "Renamed album");
        assert!(albums[0].favorite);
        assert_eq!(artwork::read(app_dir, &original).as_deref(), Some(COVER));

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
        assert_eq!(album_artwork(&db, "plain").unwrap(), None);
        assert!(!app_dir.join("artwork").join(original).exists());
        assert_eq!(delete_album(&mut db, app_dir, "cover").unwrap(), 1);
        assert!(!app_dir.join("artwork").join(replacement).exists());
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

        let mut changed = album("cover");
        changed.title = "Failed update".into();
        assert!(
            update_album(
                &mut db,
                app_dir,
                changed,
                Some(ArtworkChange::Replace(b"invalid artwork".to_vec())),
            )
            .is_err()
        );

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
        db.execute_batch("DROP TRIGGER reject_update; DROP TRIGGER reject_delete;")
            .unwrap();
        drop(db);

        let mut db = initialize_database(app_dir, None).unwrap();
        assert_eq!(fs::read_dir(app_dir.join("artwork")).unwrap().count(), 1);
        let mut saved = get_albums(&db).unwrap().pop().unwrap();
        assert_eq!(saved.title, "Title");
        assert_eq!(saved.artwork.as_deref(), Some(original.as_str()));
        assert_eq!(artwork::read(app_dir, &original).as_deref(), Some(COVER));

        let orphan = "0123456789abcdef0123456789abcdef.webp";
        artwork::write(app_dir, orphan, COVER).unwrap();
        clean_orphaned_artwork(&mut db, app_dir).unwrap();
        assert!(artwork::read(app_dir, orphan).is_none());
        assert!(artwork::read(app_dir, &original).is_some());

        saved.title = "Retried update".into();
        let replacement = update_album(
            &mut db,
            app_dir,
            saved,
            Some(ArtworkChange::Replace(COVER.to_vec())),
        )
        .unwrap()
        .artwork
        .unwrap();
        assert!(!app_dir.join("artwork").join(original).exists());
        assert_eq!(artwork::read(app_dir, &replacement).as_deref(), Some(COVER));
        assert_eq!(get_albums(&db).unwrap()[0].title, "Retried update");
        assert_eq!(fs::read_dir(app_dir.join("artwork")).unwrap().count(), 1);
    }

    #[test]
    fn artwork_rejects_invalid_dimensions_payloads_and_paths() {
        let mut too_wide = COVER.to_vec();
        too_wide[26..28].copy_from_slice(&501u16.to_le_bytes());
        assert!(!artwork::validate(&too_wide));
        assert!(!artwork::validate(&COVER[..COVER.len() - 1]));
        assert!(!artwork::validate(&vec![0; 1024 * 1024 + 1]));
        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let name = "0123456789abcdef0123456789abcdef.webp";
        let outside = app_dir.join(name);
        fs::write(&outside, COVER).unwrap();
        fs::create_dir(app_dir.join("artwork")).unwrap();

        for path in [
            format!("../{name}"),
            format!("..\\{name}"),
            outside.to_string_lossy().into_owned(),
        ] {
            assert!(artwork::write(app_dir, &path, COVER).is_err());
            assert_eq!(
                artwork::read_checked(app_dir, &path).unwrap_err().kind(),
                io::ErrorKind::InvalidInput
            );
        }
        assert_eq!(fs::read(outside).unwrap(), COVER);
        assert_eq!(
            artwork::read_checked(app_dir, name).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );

        let corrupt = app_dir.join("artwork").join(name);
        fs::write(&corrupt, b"invalid artwork").unwrap();
        assert_eq!(
            artwork::read_checked(app_dir, name).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert!(artwork::write(app_dir, name, COVER).is_err());
        assert_eq!(fs::read(corrupt).unwrap(), b"invalid artwork");
    }
}
