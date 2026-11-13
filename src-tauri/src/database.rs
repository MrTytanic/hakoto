use std::{
    collections::{HashMap, hash_map::Entry},
    error::Error,
    fs, io,
    path::Path,
};

use rusqlite::{
    Connection, OpenFlags, OptionalExtension, TransactionBehavior, params,
    types::{FromSql, FromSqlError, FromSqlResult, ValueRef},
};

use crate::{artwork, metadata, profile, shelves};

const LEGACY_DATABASE_NAME: &str = "sleevy.db";
pub const DATABASE_NAME: &str = "hakoto.db";
pub(crate) const INSERT_ALBUM: &str = "INSERT INTO albums
    (id, title, artist, format, release_year, artwork, favorite, pinned, date_added, condition,
     record_type, disc_size, original_release_year, date_acquired, notes, ownership)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)";

const LEGACY_YEAR: &str = "CASE WHEN length(trim(release_year)) BETWEEN 1 AND 4
    AND trim(release_year) NOT GLOB '*[^0-9]*'
    AND CAST(release_year AS INTEGER) BETWEEN 1 AND 9999
    THEN CAST(release_year AS INTEGER) ELSE NULL END";

const ALBUM_COLUMNS: &str = "id, title, artist, format, release_year, artwork, favorite,
    pinned, date_added, condition, record_type, disc_size, original_release_year, date_acquired,
    notes, ownership";

pub(crate) fn database_error(error: rusqlite::Error) -> String {
    use rusqlite::ErrorCode;

    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => {
            "The collection database is busy. Try again."
        }
        Some(ErrorCode::ReadOnly | ErrorCode::PermissionDenied) => {
            "Hakoto cannot write to the collection database. Check its permissions."
        }
        Some(ErrorCode::DiskFull) => "There is not enough disk space to save the change.",
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => {
            "The collection database could not be read. Check your backups."
        }
        Some(ErrorCode::ConstraintViolation) => {
            "This change conflicts with existing collection data."
        }
        _ => "The collection database operation could not be completed.",
    }
    .into()
}

pub fn initialize_database(
    app_dir: &Path,
    legacy_dir: Option<&Path>,
) -> Result<Connection, Box<dyn Error>> {
    let mut connection = Connection::open_with_flags(
        app_dir.join(DATABASE_NAME),
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    connection.pragma_update(None, "trusted_schema", false)?;
    connection.pragma_update(None, "foreign_keys", true)?;
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
    crate::crates::migrate(&transaction)?;
    profile::initialize(&transaction)?;

    // Commit the table and its imported rows together so a failed import can be retried.
    if !already_initialized && let Some(legacy_dir) = legacy_dir {
        import_legacy_albums(&transaction, app_dir, legacy_dir)?;
    }
    transaction.commit()?;
    shelves::migrate(&mut connection)?;
    Ok(connection)
}

fn has_album_column(connection: &Connection, name: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info('albums') WHERE name = ?1)",
        [name],
        |row| row.get(0),
    )
}

pub(crate) fn migrate_album_columns(connection: &Connection) -> rusqlite::Result<()> {
    if !has_album_column(connection, "pinned")? {
        connection.execute_batch(
            "ALTER TABLE albums ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE albums ADD COLUMN date_added TEXT;
             ALTER TABLE albums ADD COLUMN condition TEXT;
             ALTER TABLE albums ADD COLUMN record_type TEXT;
             ALTER TABLE albums ADD COLUMN disc_size TEXT;",
        )?;
    }
    if !has_album_column(connection, "original_release_year")? {
        // Keep the albums table in place so foreign keys continue to reference the same IDs.
        connection.execute_batch(&format!(
            "ALTER TABLE albums ADD COLUMN edition_year_v2 INTEGER
                 CHECK (typeof(edition_year_v2) = 'null' OR
                        (typeof(edition_year_v2) = 'integer' AND edition_year_v2 BETWEEN 1 AND 9999));
             UPDATE albums SET edition_year_v2 = {LEGACY_YEAR};
             ALTER TABLE albums DROP COLUMN release_year;
             ALTER TABLE albums RENAME COLUMN edition_year_v2 TO release_year;
             ALTER TABLE albums ADD COLUMN original_release_year INTEGER
                 CHECK (typeof(original_release_year) = 'null' OR
                        (typeof(original_release_year) = 'integer' AND original_release_year BETWEEN 1 AND 9999));
             ALTER TABLE albums ADD COLUMN date_acquired TEXT;
             ALTER TABLE albums ADD COLUMN notes TEXT;"
        ))?;
    }
    if !has_album_column(connection, "ownership")? {
        connection.execute_batch(
            "ALTER TABLE albums ADD COLUMN ownership TEXT NOT NULL DEFAULT 'owned'
                 CHECK (ownership IN ('owned', 'wishlist'));",
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

    let mut source = Connection::open_with_flags(
        legacy_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    source.pragma_update(None, "trusted_schema", false)?;
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

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub format: String,
    pub release_year: Option<u16>,
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
    pub original_release_year: Option<u16>,
    pub date_acquired: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub ownership: Ownership,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ownership {
    #[default]
    Owned,
    Wishlist,
}

impl Ownership {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Owned => "owned",
            Self::Wishlist => "wishlist",
        }
    }
}

impl FromSql for Ownership {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "owned" => Ok(Self::Owned),
            "wishlist" => Ok(Self::Wishlist),
            _ => Err(FromSqlError::Other("Invalid album ownership".into())),
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", content = "bytes", rename_all = "camelCase")]
pub enum ArtworkChange {
    Remove,
    Replace(Vec<u8>),
}

pub fn get_albums(connection: &Connection) -> rusqlite::Result<Vec<Album>> {
    let extended = has_album_column(connection, "original_release_year")?;
    let year = if extended {
        "release_year"
    } else {
        LEGACY_YEAR
    };
    let metadata = if extended || has_album_column(connection, "pinned")? {
        "pinned, date_added, condition, record_type, disc_size"
    } else {
        "0, NULL, NULL, NULL, NULL"
    };
    let extra = if extended {
        "original_release_year, date_acquired, notes"
    } else {
        "NULL, NULL, NULL"
    };
    let ownership = if has_album_column(connection, "ownership")? {
        "ownership"
    } else {
        "'owned'"
    };
    let mut statement = connection.prepare(&format!(
        "SELECT id, title, artist, format, {year}, artwork, favorite, {metadata}, {extra}, {ownership}
         FROM albums ORDER BY rowid ASC"
    ))?;

    let albums = statement.query_map([], read_album)?;

    albums.collect()
}

#[derive(serde::Serialize)]
pub struct AlbumLibrary {
    pub owned: Vec<Album>,
    pub wishlist: Vec<Album>,
}

pub fn get_album_library(connection: &mut Connection) -> rusqlite::Result<AlbumLibrary> {
    // Read both scopes in one snapshot so an acquisition cannot appear twice or be missed.
    let transaction = connection.transaction()?;
    let library = {
        let mut statement = transaction.prepare(&format!(
            "SELECT {ALBUM_COLUMNS} FROM albums WHERE ownership = ?1 ORDER BY rowid ASC"
        ))?;
        let owned = statement
            .query_map([Ownership::Owned.as_str()], read_album)?
            .collect::<rusqlite::Result<_>>()?;
        let wishlist = statement
            .query_map([Ownership::Wishlist.as_str()], read_album)?
            .collect::<rusqlite::Result<_>>()?;
        AlbumLibrary { owned, wishlist }
    };
    transaction.commit()?;
    Ok(library)
}

fn read_album(row: &rusqlite::Row<'_>) -> rusqlite::Result<Album> {
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
        original_release_year: row.get(12)?,
        date_acquired: row.get(13)?,
        notes: row.get(14)?,
        ownership: row.get(15)?,
    })
}

pub(crate) fn verify_album_rows(connection: &Connection) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("SELECT {ALBUM_COLUMNS} FROM albums"))?;
    for album in statement.query_map([], read_album)? {
        album?;
    }
    Ok(())
}

pub fn get_album(connection: &Connection, id: &str) -> rusqlite::Result<Option<Album>> {
    connection
        .query_row(
            &format!("SELECT {ALBUM_COLUMNS} FROM albums WHERE id = ?1"),
            [id],
            |row| {
                let mut album = read_album(row)?;
                // Internal mutation snapshots preserve legacy references without treating them as paths.
                album.artwork = row.get(5)?;
                Ok(album)
            },
        )
        .optional()
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

pub fn acquire_album(
    connection: &mut Connection,
    id: &str,
    format: &str,
    date_acquired: &str,
) -> Result<Album, String> {
    let format = metadata::validate_format(format, Ownership::Owned)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    metadata::validate_acquisition_date(&transaction, date_acquired)?;
    metadata::album_reference(&transaction, id)?;
    let wishlist = get_album(&transaction, id)
        .map_err(database_error)?
        .filter(|album| album.ownership == Ownership::Wishlist)
        .ok_or("Could not acquire this album. It may no longer be on your wishlist.")?;
    if !metadata::vinyl_fields_match_format(&wishlist, format) {
        return Err("Choose a vinyl format or remove the vinyl details from this wishlist album before acquiring it.".into());
    }
    let updated = transaction
        .execute(
            "UPDATE albums SET ownership = 'owned', format = ?2, date_acquired = ?3
             WHERE id = ?1 AND ownership = 'wishlist'",
            params![id, format, date_acquired],
        )
        .map_err(database_error)?;
    if updated != 1 {
        return Err("Could not acquire this album. It may no longer be on your wishlist.".into());
    }
    let album = get_album(&transaction, id)
        .map_err(database_error)?
        .ok_or("Album no longer exists.")?;
    transaction.commit().map_err(database_error)?;
    Ok(album)
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
        .map_err(database_error)?;
    let existing = if insert {
        None
    } else {
        metadata::album_reference(&transaction, &album.id)?;
        Some(
            get_album(&transaction, &album.id)
                .map_err(database_error)?
                .ok_or("Album no longer exists.")?,
        )
    };
    if existing
        .as_ref()
        .is_some_and(|old| old.ownership != album.ownership)
    {
        return Err("Album ownership has changed. Reopen the album before editing it.".into());
    }
    metadata::validate(&transaction, &mut album, existing.as_ref())?;
    let previous = existing.as_ref().and_then(|old| old.artwork.clone());
    album.date_added = if let Some(existing) = existing {
        existing.date_added
    } else {
        transaction
            .query_row("SELECT date('now')", [], |row| row.get(0))
            .map_err(database_error)?
    };

    let mut new_file = None;
    album.artwork = match change {
        None => previous.clone(),
        Some(ArtworkChange::Remove) => None,
        Some(ArtworkChange::Replace(bytes)) => {
            if !artwork::validate(&bytes) {
                return Err("Choose valid WebP artwork up to 500 × 500 pixels and 1 MiB.".into());
            }
            let name = image_filename(&transaction).map_err(database_error)?;
            artwork::write(app_dir, &name, &bytes).map_err(
                |_| "Could not save the album artwork. Check storage permissions and free space.",
            )?;
            new_file = Some(name.clone());
            Some(name)
        }
    };

    let sql = if insert {
        INSERT_ALBUM
    } else {
        "UPDATE albums SET title = ?2, artist = ?3, format = ?4, release_year = ?5,
                           artwork = ?6, favorite = ?7, pinned = ?8, date_added = ?9,
                           condition = ?10, record_type = ?11, disc_size = ?12,
                           original_release_year = ?13, date_acquired = ?14, notes = ?15,
                           ownership = ?16 WHERE id = ?1"
    };
    let result = write_album(&transaction, sql, &album).and_then(|rows| {
        if rows == 1 {
            transaction.commit()
        } else {
            Err(rusqlite::Error::QueryReturnedNoRows)
        }
    });

    if let Err(error) = result {
        // The transaction has rolled back. Check references even if commit reported an error.
        cleanup(connection, app_dir, new_file.as_deref());
        return Err(database_error(error));
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
            album.original_release_year,
            album.date_acquired,
            album.notes,
            album.ownership.as_str(),
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
        .map_err(database_error)?;
    metadata::album_reference(&transaction, id)?;
    let Some(previous) = transaction
        .query_row("SELECT artwork FROM albums WHERE id = ?1", [id], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()
        .map_err(database_error)?
    else {
        return Ok(0);
    };
    let rows = transaction
        .execute("DELETE FROM albums WHERE id = ?1", [id])
        .map_err(database_error)?;
    if rows != 1 {
        return Err("Album deletion was not completed. Nothing was changed.".into());
    }
    transaction.commit().map_err(database_error)?;
    cleanup(connection, app_dir, previous.as_deref());
    Ok(rows)
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

    let path = directory.join(name);
    if !referenced && crate::storage::checked_file(&path).is_ok() {
        match fs::remove_file(path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.to_string()),
            _ => {}
        }
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
            release_year: Some(1999),
            artwork: None,
            favorite: false,
            pinned: false,
            date_added: None,
            condition: None,
            record_type: None,
            disc_size: None,
            original_release_year: None,
            date_acquired: None,
            notes: None,
            ownership: Ownership::Owned,
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
    fn validates_changed_metadata_before_artwork_writes_and_binds_sql_values() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let id = "album'; DROP TABLE albums; --";
        let mut candidate = album(id);
        candidate.title = "音楽 — L'été".into();
        let saved = save_album(&mut db, path, candidate, Some(COVER.to_vec())).unwrap();
        assert_eq!(get_album(&db, id).unwrap().unwrap().title, saved.title);
        for field in [
            "blank",
            "control",
            "long",
            "artist",
            "format",
            "year",
            "original-year",
            "acquired",
            "notes",
            "condition",
            "record",
            "size",
            "non-vinyl",
        ] {
            let mut invalid = get_album(&db, id).unwrap().unwrap();
            match field {
                "blank" => invalid.title = "  ".into(),
                "control" => invalid.artist = "Bad\0Name".into(),
                "long" => invalid.title = "x".repeat(501),
                "artist" => invalid.artist = "x".repeat(301),
                "format" => invalid.format = "".into(),
                "year" => invalid.release_year = Some(0),
                "original-year" => invalid.original_release_year = Some(10000),
                "acquired" => invalid.date_acquired = Some("2025-02-29".into()),
                "notes" => invalid.notes = Some("x".repeat(1001)),
                "condition" => invalid.condition = Some("Unknown".into()),
                "record" => invalid.record_type = Some("Double".into()),
                "size" => invalid.disc_size = Some("8".into()),
                "non-vinyl" => invalid.record_type = Some("LP".into()),
                _ => unreachable!(),
            }
            assert!(
                update_album(
                    &mut db,
                    path,
                    invalid,
                    Some(ArtworkChange::Replace(COVER.to_vec()))
                )
                .is_err(),
                "{field}"
            );
            assert_eq!(fs::read_dir(path.join("artwork")).unwrap().count(), 1);
            assert_eq!(get_album(&db, id).unwrap().unwrap().title, saved.title);
        }
        let mut valid = get_album(&db, id).unwrap().unwrap();
        valid.favorite = true;
        valid.condition = Some("Near Mint".into());
        valid.release_year = None;
        let result = update_album(&mut db, path, valid, None).unwrap();
        assert!(result.favorite);
        assert_eq!(result.date_added, saved.date_added);
        let mut forged = serde_json::to_value(&result).unwrap();
        forged["dateAdded"] = serde_json::json!("not-a-date");
        forged["artwork"] = serde_json::json!("../private.webp");
        let result =
            update_album(&mut db, path, serde_json::from_value(forged).unwrap(), None).unwrap();
        assert_eq!(result.date_added, saved.date_added);
        assert_eq!(result.artwork, saved.artwork);
        assert!(serde_json::from_str::<Album>(r#"{"id":"bad","title":"\ud800","artist":"Artist","format":"CD","releaseYear":null,"favorite":false}"#).is_err());
    }

    #[test]
    fn legacy_metadata_is_preserved_until_edited_and_invalid_database_text_returns_an_error() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        save_album(&mut db, path, album("legacy"), None).unwrap();
        let title = "x".repeat(700);
        db.execute("UPDATE albums SET title = ?1, condition = 'Legacy condition',
                    record_type = 'Legacy type', date_added = 'invalid date', artwork = '../invalid.webp' WHERE id = 'legacy'", [&title]).unwrap();
        let mut legacy = get_album(&db, "legacy").unwrap().unwrap();
        legacy.favorite = true;
        let saved = update_album(&mut db, path, legacy, None).unwrap();
        assert_eq!(saved.title, title);
        assert_eq!(saved.condition.as_deref(), Some("Legacy condition"));
        assert_eq!(saved.record_type.as_deref(), Some("Legacy type"));
        assert_eq!(saved.date_added.as_deref(), Some("invalid date"));
        assert_eq!(saved.artwork.as_deref(), Some("../invalid.webp"));
        assert!(get_albums(&db).unwrap()[0].artwork.is_none());
        db.execute(
            "UPDATE albums SET title = CAST(x'80' AS TEXT) WHERE id = 'legacy'",
            [],
        )
        .unwrap();
        assert!(get_albums(&db).is_err());
    }

    #[test]
    fn ignored_writes_roll_back_album_updates_and_recovery_without_losing_artwork() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let saved = save_album(&mut db, path, album("cover"), Some(COVER.to_vec())).unwrap();
        db.execute_batch(
            "CREATE TRIGGER ignore_update BEFORE UPDATE ON albums BEGIN SELECT RAISE(IGNORE); END;",
        )
        .unwrap();
        let mut changed = get_album(&db, "cover").unwrap().unwrap();
        changed.title = "Changed".into();
        assert!(
            update_album(
                &mut db,
                path,
                changed,
                Some(ArtworkChange::Replace(COVER.to_vec()))
            )
            .is_err()
        );
        assert_eq!(fs::read_dir(path.join("artwork")).unwrap().count(), 1);
        db.execute_batch("DROP TRIGGER ignore_update; CREATE TRIGGER ignore_archive BEFORE INSERT ON undo_albums BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(crate::undo::delete(&mut db, "cover").is_err());
        assert!(get_album(&db, "cover").unwrap().is_some());
        db.execute_batch("DROP TRIGGER ignore_archive; CREATE TRIGGER ignore_delete BEFORE DELETE ON albums BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(crate::undo::delete(&mut db, "cover").is_err());
        assert!(crate::undo::pending(&db).unwrap().is_empty());
        db.execute_batch("DROP TRIGGER ignore_delete;").unwrap();
        let token = crate::undo::delete(&mut db, "cover").unwrap();
        db.execute_batch(
            "CREATE TRIGGER ignore_insert BEFORE INSERT ON albums BEGIN SELECT RAISE(IGNORE); END;",
        )
        .unwrap();
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert!(get_album(&db, "cover").unwrap().is_none());
        assert_eq!(crate::undo::pending(&db).unwrap().len(), 1);
        db.execute_batch("DROP TRIGGER ignore_insert; CREATE TRIGGER ignore_discard BEFORE DELETE ON undo_albums BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert!(crate::undo::discard(&mut db, path, &token).is_err());
        assert!(get_album(&db, "cover").unwrap().is_none());
        assert!(artwork::read(path, saved.artwork.as_deref().unwrap()).is_some());
        db.execute_batch("DROP TRIGGER ignore_discard;").unwrap();
        crate::undo::restore(&mut db, path, &token).unwrap();
        db.execute_batch("INSERT INTO shelves (name, rows, columns, orientation) VALUES ('Shelf', 1, 1, 'vertical'); INSERT INTO shelf_placements VALUES (1, 0, 0, 'cover');").unwrap();
        let token = crate::undo::delete(&mut db, "cover").unwrap();
        db.execute_batch("CREATE TRIGGER ignore_restored_slot BEFORE INSERT ON shelf_placements BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(crate::undo::restore(&mut db, path, &token).is_err());
        assert!(get_album(&db, "cover").unwrap().is_none());
        assert_eq!(crate::undo::pending(&db).unwrap().len(), 1);
        db.execute_batch("DROP TRIGGER ignore_restored_slot;")
            .unwrap();
        crate::undo::restore(&mut db, path, &token).unwrap();
    }

    #[test]
    fn ignored_profile_writes_and_control_characters_report_errors() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        profile::set_display_name(&db, "Saved").unwrap();
        assert!(profile::set_display_name(&db, "Bad\0Name").is_err());
        let original =
            profile::set_picture(&mut db, path, ArtworkChange::Replace(COVER.to_vec())).unwrap();
        db.execute_batch("CREATE TRIGGER ignore_profile BEFORE UPDATE ON profile BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(profile::set_display_name(&db, "Changed").is_err());
        assert!(
            profile::set_picture(&mut db, path, ArtworkChange::Replace(COVER.to_vec())).is_err()
        );
        let saved = profile::get(&db).unwrap();
        assert_eq!(saved.display_name, "Saved");
        assert_eq!(saved.profile_picture, original);
        assert_eq!(
            fs::read_dir(path.join(profile::IMAGE_DIRECTORY))
                .unwrap()
                .count(),
            1
        );
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
        assert!(saved.release_year.is_none());
    }

    #[test]
    fn migrates_text_years_with_shelf_foreign_keys_and_legacy_undo_records() {
        let directory = TestDirectory::new();
        let mut db = Connection::open(directory.0.join(DATABASE_NAME)).unwrap();
        db.execute_batch(
            "CREATE TABLE albums (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, format TEXT NOT NULL,
                release_year TEXT NOT NULL, artwork TEXT, favorite INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0, date_added TEXT, condition TEXT, record_type TEXT, disc_size TEXT
             );
             INSERT INTO albums (id, title, artist, format, release_year, artwork, favorite, pinned, date_added)
             VALUES ('placed', 'Title', 'Artist', 'CD', '0042', '12345678901234567890123456789012.webp', 1, 1, '2020-01-02'),
                    ('unknown', 'Title', 'Artist', 'CD', 'unknown', NULL, 0, 0, NULL);",
        ).unwrap();
        crate::undo::initialize(&db).unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE shelves (id INTEGER PRIMARY KEY, name TEXT, rows INTEGER, columns INTEGER, orientation TEXT);
             CREATE TABLE shelf_placements (shelf_id INTEGER REFERENCES shelves(id), row_index INTEGER,
                 column_index INTEGER, album_id TEXT REFERENCES albums(id) ON DELETE CASCADE,
                 PRIMARY KEY (shelf_id, row_index, column_index));
             INSERT INTO shelves (id, name, rows, columns, orientation) VALUES (1, 'Shelf', 1, 1, 'vertical');
             INSERT INTO shelf_placements VALUES (1, 0, 0, 'placed');",
        ).unwrap();
        let archived = serde_json::json!({
            "album": {"id": "archived", "title": "Old copy", "artist": "Artist", "format": "CD", "releaseYear": "1990", "favorite": false},
            "artwork": null, "date_added": null, "placements": []
        });
        db.execute(
            "INSERT INTO undo_albums VALUES ('legacy', ?1, NULL, unixepoch() + 100)",
            [archived.to_string()],
        )
        .unwrap();
        let transaction = db.transaction().unwrap();
        migrate_album_columns(&transaction).unwrap();
        transaction.commit().unwrap();
        drop(db);

        let mut db = initialize_database(&directory.0, None).unwrap();
        let placed = get_album(&db, "placed").unwrap().unwrap();
        assert_eq!(placed.release_year, Some(42));
        assert_eq!(placed.ownership, Ownership::Owned);
        assert!(placed.favorite && placed.pinned);
        assert_eq!(
            placed.artwork.as_deref(),
            Some("12345678901234567890123456789012.webp")
        );
        assert_eq!(placed.date_added.as_deref(), Some("2020-01-02"));
        let unknown = get_album(&db, "unknown").unwrap().unwrap();
        assert!(unknown.release_year.is_none());
        assert!(unknown.original_release_year.is_none());
        assert!(unknown.date_acquired.is_none());
        assert!(unknown.notes.is_none());
        assert_eq!(
            shelves::load_shelf(&mut db, 1).unwrap().placements[0].album_id,
            "placed"
        );
        let restored = crate::undo::restore(&mut db, &directory.0, "legacy").unwrap();
        assert_eq!(restored.release_year, Some(1990));
        assert_eq!(restored.ownership, Ownership::Owned);
        assert!(restored.notes.is_none());
    }

    #[test]
    fn wishlist_acquisition_preserves_the_album_and_its_artwork_in_place() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let mut copy = album("owned-copy");
        copy.format = "Digital (FLAC)".into();
        copy.condition = Some("Mint".into());
        copy.date_acquired = Some("2023-01-01".into());
        save_album(&mut db, path, copy, None).unwrap();
        db.execute_batch(
            "INSERT INTO shelves VALUES (1, 'Shelf', 1, 2, 'vertical');
             INSERT INTO shelf_placements VALUES (1, 0, 0, 'owned-copy');",
        )
        .unwrap();
        let mut candidate = album("wish");
        candidate.ownership = Ownership::Wishlist;
        candidate.format.clear();
        candidate.notes = Some("First line\nSecond line".into());
        candidate.original_release_year = Some(1980);
        candidate.condition = Some("Very Good+".into());
        let wishlist = save_album(&mut db, path, candidate, Some(COVER.to_vec())).unwrap();
        let name = wishlist.artwork.as_deref().unwrap();

        let token = crate::undo::delete(&mut db, "wish").unwrap();
        assert_eq!(
            crate::undo::restore(&mut db, path, &token)
                .unwrap()
                .ownership,
            Ownership::Wishlist
        );
        drop(db);

        let mut db = initialize_database(path, None).unwrap();
        let library = get_album_library(&mut db).unwrap();
        assert_eq!(library.owned.len(), 1);
        assert_eq!(library.owned[0].id, "owned-copy");
        assert_eq!(library.wishlist.len(), 1);
        assert_eq!(library.wishlist[0].id, "wish");
        assert_eq!(
            get_album(&db, "wish").unwrap().unwrap().ownership,
            Ownership::Wishlist
        );
        let acquired = acquire_album(&mut db, "wish", "Digital (FLAC)", "2024-02-29").unwrap();
        assert_eq!(acquired.ownership, Ownership::Owned);
        assert_eq!(acquired.id, wishlist.id);
        assert_eq!(acquired.artwork.as_deref(), Some(name));
        assert_eq!(artwork::read(path, name).as_deref(), Some(COVER));
        assert_eq!(acquired.date_added, wishlist.date_added);
        assert_eq!(acquired.date_acquired.as_deref(), Some("2024-02-29"));
        assert_eq!(acquired.format, "Digital (FLAC)");
        assert_eq!(acquired.condition.as_deref(), Some("Very Good+"));
        assert_eq!(acquired.notes, wishlist.notes);
        assert_eq!(acquired.release_year, wishlist.release_year);
        assert_eq!(
            acquired.original_release_year,
            wishlist.original_release_year
        );
        assert!(acquire_album(&mut db, "wish", "CD", "2025-01-01").is_err());
        assert!(update_album(&mut db, path, wishlist, None).is_err());
        db.execute("INSERT INTO shelf_placements VALUES (1, 0, 1, 'wish')", [])
            .unwrap();
        drop(db);

        let mut db = initialize_database(path, None).unwrap();
        let library = get_album_library(&mut db).unwrap();
        assert!(library.wishlist.is_empty());
        assert_eq!(library.owned.len(), 2);
        let [copy, acquired] = &library.owned[..] else {
            unreachable!()
        };
        assert_eq!(copy.title, acquired.title);
        assert_eq!(copy.artist, acquired.artist);
        assert_eq!(copy.format, acquired.format);
        assert_ne!(copy.id, acquired.id);
        assert_eq!(copy.condition.as_deref(), Some("Mint"));
        assert_eq!(copy.date_acquired.as_deref(), Some("2023-01-01"));
        assert_eq!(acquired.condition.as_deref(), Some("Very Good+"));
        assert_eq!(acquired.date_acquired.as_deref(), Some("2024-02-29"));
        let layout = shelves::load_shelf(&mut db, 1).unwrap();
        assert_eq!(layout.shelf.occupied, 2);
        assert_eq!(layout.placements[0].album_id, copy.id);
        assert_eq!(layout.placements[1].album_id, acquired.id);
    }

    #[test]
    fn failed_acquisition_leaves_wishlist_albums_unchanged_and_off_shelves() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let mut candidate = album("wish");
        candidate.ownership = Ownership::Wishlist;
        save_album(&mut db, path, candidate, None).unwrap();
        db.execute(
            "INSERT INTO shelves VALUES (1, 'Shelf', 1, 1, 'vertical')",
            [],
        )
        .unwrap();
        let placement = "INSERT INTO shelf_placements VALUES (1, 0, 0, 'wish')";
        assert!(db.execute(placement, []).is_err());
        assert!(acquire_album(&mut db, "wish", "", "2024-02-29").is_err());
        assert!(acquire_album(&mut db, "wish", "Vinyl", "2025-02-29").is_err());
        db.execute_batch(
            "CREATE TRIGGER fail_acquisition AFTER UPDATE OF ownership ON albums
             BEGIN SELECT RAISE(ABORT, 'forced acquisition failure'); END;",
        )
        .unwrap();
        assert!(acquire_album(&mut db, "wish", "Vinyl", "2024-02-29").is_err());
        let unchanged = get_album(&db, "wish").unwrap().unwrap();
        assert_eq!(unchanged.ownership, Ownership::Wishlist);
        assert_eq!(unchanged.format, "CD");
        assert!(unchanged.date_acquired.is_none());
        assert!(db.execute(placement, []).is_err());
        db.execute_batch("DROP TRIGGER fail_acquisition;").unwrap();
        acquire_album(&mut db, "wish", "Vinyl", "2024-02-29").unwrap();
        assert_eq!(db.execute(placement, []).unwrap(), 1);
    }

    #[test]
    fn acquisition_rejects_an_incompatible_format_without_losing_vinyl_details() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let mut candidate = album("wishlist-vinyl");
        candidate.ownership = Ownership::Wishlist;
        candidate.format = "Vinyl".into();
        candidate.record_type = Some("LP".into());
        candidate.disc_size = Some("12".into());
        save_album(&mut db, path, candidate, None).unwrap();

        let id = "wishlist-vinyl";
        let error = acquire_album(&mut db, id, "CD", "2024-02-29")
            .err()
            .unwrap();
        assert!(error.contains("vinyl details"));
        let unchanged = get_album(&db, id).unwrap().unwrap();
        assert_eq!(unchanged.ownership, Ownership::Wishlist);
        assert_eq!(unchanged.format, "Vinyl");
        assert_eq!(unchanged.record_type.as_deref(), Some("LP"));
        assert_eq!(unchanged.disc_size.as_deref(), Some("12"));
        assert!(unchanged.date_acquired.is_none());
        assert_eq!(
            acquire_album(&mut db, id, "Vinyl", "2024-02-29")
                .unwrap()
                .ownership,
            Ownership::Owned
        );
    }

    #[test]
    fn album_mutations_validate_unknown_ids_and_hide_database_failure_details() {
        let directory = TestDirectory::new();
        let path = &directory.0;
        let mut db = initialize_database(path, None).unwrap();
        let id = "Björk'; DELETE FROM albums; --";
        save_album(&mut db, path, album(id), None).unwrap();
        assert!(
            delete_album(&mut db, path, "\0")
                .unwrap_err()
                .contains("Album ID")
        );
        db.execute_batch(
            "CREATE TRIGGER reject_album_delete BEFORE DELETE ON albums
             BEGIN SELECT RAISE(ABORT, 'private local database detail'); END;",
        )
        .unwrap();
        assert_eq!(
            delete_album(&mut db, path, id).unwrap_err(),
            "This change conflicts with existing collection data."
        );
        assert!(get_album(&db, id).unwrap().is_some());
        db.execute_batch("DROP TRIGGER reject_album_delete;")
            .unwrap();

        let legacy_id = "x".repeat(129);
        db.execute(
            "UPDATE albums SET id = ?1 WHERE id = ?2",
            params![legacy_id, id],
        )
        .unwrap();
        assert_eq!(delete_album(&mut db, path, &legacy_id).unwrap(), 1);
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
        saved.release_year = Some(2001);
        saved.original_release_year = Some(1);
        saved.date_acquired = Some("2024-02-29".into());
        saved.notes = Some("First line\r\nSecond line".into());
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
        assert_eq!(updated.release_year, Some(2001));
        assert_eq!(updated.original_release_year, Some(1));
        assert_eq!(updated.date_acquired.as_deref(), Some("2024-02-29"));
        assert_eq!(updated.notes.as_deref(), Some("First line\nSecond line"));
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
        assert_eq!(albums[0].release_year, Some(1999));
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
        let stored = get_album(&db, "cover").unwrap().unwrap().artwork.unwrap();
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
        assert_eq!(get_album(&db, "plain").unwrap().unwrap().artwork, None);
        assert_eq!(albums[1].release_year, Some(1999));

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
        assert_eq!(get_album(&db, "plain").unwrap().unwrap().artwork, None);
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
        fs::File::create(&corrupt)
            .unwrap()
            .set_len(artwork::MAX_BYTES as u64 + 1)
            .unwrap();
        assert_eq!(
            artwork::read_checked(app_dir, name).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        fs::write(&corrupt, b"invalid artwork").unwrap();
        assert_eq!(
            artwork::read_checked(app_dir, name).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert!(artwork::write(app_dir, name, COVER).is_err());
        assert_eq!(fs::read(corrupt).unwrap(), b"invalid artwork");
    }

    #[cfg(unix)]
    #[test]
    fn managed_image_reads_writes_and_cleanup_leave_link_targets_untouched() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new();
        let app_dir = &directory.0;
        let mut db = initialize_database(app_dir, None).unwrap();
        let outside = app_dir.join("outside");
        fs::create_dir(&outside).unwrap();
        let name = "0123456789abcdef0123456789abcdef.webp";
        fs::write(outside.join(name), COVER).unwrap();
        let artwork_dir = app_dir.join("artwork");
        symlink(&outside, &artwork_dir).unwrap();
        assert!(artwork::read_checked(app_dir, name).is_err());
        assert!(artwork::write(app_dir, name, COVER).is_err());
        assert!(clean_orphaned_artwork(&mut db, app_dir).is_err());

        fs::create_dir(app_dir.join(profile::IMAGE_DIRECTORY)).unwrap();
        let picture = app_dir.join(profile::IMAGE_DIRECTORY).join(name);
        symlink(outside.join(name), &picture).unwrap();
        assert!(profile::read_image(app_dir, name).is_none());
        profile::clean_orphaned_images(&mut db, app_dir).unwrap();
        assert!(picture.symlink_metadata().unwrap().is_symlink());
        assert_eq!(fs::read(outside.join(name)).unwrap(), COVER);
    }
}
