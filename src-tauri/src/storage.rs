use std::{
    error::Error,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

use rusqlite::{
    Connection, OpenFlags, TransactionBehavior,
    backup::{Backup, StepResult},
};
use serde::{Deserialize, Serialize};

use crate::{
    artwork,
    database::{self, DATABASE_NAME},
    profile, shelves,
};

const LOCATION_FILE: &str = "storage-location.json";
const FOLDER_PREFIX: &str = "hakoto-collection-";
pub const ARTWORK_DIRECTORY: &str = "artwork";
const IMAGE_FOLDERS: [&str; 2] = [ARTWORK_DIRECTORY, profile::IMAGE_DIRECTORY];
type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Deserialize, Serialize)]
struct Location {
    directory: PathBuf,
    previous: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    database_path: PathBuf,
    artwork_path: PathBuf,
    database_bytes: u64,
    artwork_bytes: u64,
    profile_bytes: u64,
    total_bytes: u64,
    is_default: bool,
    previous_location: Option<PathBuf>,
}

pub struct Storage {
    default_dir: PathBuf,
    pub directory: PathBuf,
    pub connection: Connection,
    previous_location: Option<PathBuf>,
    // Release the fixed app-data lock after closing the active SQLite connection.
    _lock: File,
}

impl Storage {
    pub fn open(default_dir: &Path, legacy_dir: Option<&Path>) -> Result<Self> {
        fs::create_dir_all(default_dir)?;
        let default_dir = dunce::canonicalize(default_dir)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(default_dir.join("storage.lock"))?;
        lock.try_lock().map_err(|error| {
            format!(
                "Could not lock Hakoto storage. Close any other Hakoto window and restart: {error}"
            )
        })?;

        let location = read_location(&default_dir)?;
        let (directory, connection, previous_location) = if let Some(location) = location {
            let connection = open_saved_collection(&location.directory).map_err(|error| {
                format!("Could not open the collection at {}: {error}. Reconnect or repair that location and restart Hakoto. The previous copy is at {} and may be older.", location.directory.display(), location.previous.display())
            })?;
            (location.directory, connection, Some(location.previous))
        } else {
            check_database_files(&default_dir, false)?;
            let connection = database::initialize_database(&default_dir, legacy_dir)?;
            (default_dir.clone(), connection, None)
        };
        Ok(Self {
            _lock: lock,
            default_dir,
            directory,
            connection,
            previous_location,
        })
    }

    pub fn default_dir(&self) -> &Path {
        &self.default_dir
    }

    pub fn info(&self) -> Result<StorageInfo> {
        let database_path = self.directory.join(DATABASE_NAME);
        let mut database_bytes = checked_file(&database_path)?.len();
        for suffix in ["-wal", "-shm", "-journal"] {
            match checked_file(&self.directory.join(format!("{DATABASE_NAME}{suffix}"))) {
                Ok(metadata) => database_bytes = database_bytes.saturating_add(metadata.len()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
        }
        let artwork_bytes = image_bytes(&self.directory, ARTWORK_DIRECTORY)?;
        let profile_bytes = image_bytes(&self.directory, profile::IMAGE_DIRECTORY)?;
        Ok(StorageInfo {
            database_path,
            artwork_path: self.directory.join(ARTWORK_DIRECTORY),
            database_bytes,
            artwork_bytes,
            profile_bytes,
            total_bytes: database_bytes
                .saturating_add(artwork_bytes)
                .saturating_add(profile_bytes),
            is_default: self.directory == self.default_dir
                || self.directory.parent() == Some(&self.default_dir),
            previous_location: self.previous_location.clone(),
        })
    }

    pub fn relocate(&mut self, parent: &Path) -> Result<()> {
        let parent = checked_directory(parent)?;
        #[cfg(windows)]
        if matches!(parent.components().next(), Some(Component::Prefix(prefix)) if !matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
        {
            return Err("Choose a local drive rather than a network or device path.".into());
        }
        if parent.parent().is_none() {
            return Err("Choose a folder rather than a drive root.".into());
        }
        if parent.starts_with(&self.directory)
            || self.directory.parent() == Some(&parent)
            || (self.directory.starts_with(&parent) && parent != self.default_dir)
            || (parent.starts_with(&self.default_dir) && parent != self.default_dir)
        {
            return Err(
                "Choose a folder outside the current collection and Hakoto’s app-data folders."
                    .into(),
            );
        }
        if checked_directory(&self.directory)? != self.directory {
            return Err(
                "The active collection directory no longer resolves to its original path.".into(),
            );
        }
        check_database_files(&self.directory, true)?;
        // Reserve the writer on a second connection and copy from the active one.
        let mut writer = Connection::open_with_flags(
            self.directory.join(DATABASE_NAME),
            OpenFlags::SQLITE_OPEN_READ_WRITE,
        )?;
        let source_lock = writer.transaction_with_behavior(TransactionBehavior::Immediate)?;
        check_space(&self.connection, &self.directory, &parent)?;
        let staging = tempfile::Builder::new()
            .prefix(FOLDER_PREFIX)
            .tempdir_in(&parent)?;
        let target = staging.path();

        let target_db = target.join(DATABASE_NAME);
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_db)?;
        let mut backup =
            Connection::open_with_flags(&target_db, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        if !matches!(
            Backup::new(&self.connection, &mut backup)?.step(-1)?,
            StepResult::Done
        ) {
            return Err("SQLite could not complete the backup. Close other programs using the database and try again.".into());
        }
        let mode: String =
            backup.query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))?;
        if mode != "delete" {
            return Err(
                "The database copy could not be finalized without a write-ahead log.".into(),
            );
        }
        let integrity: String = backup.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(
                format!("The database copy failed its integrity check: {integrity}").into(),
            );
        }
        backup.close().map_err(|(_, error)| error)?;
        let connection = open_saved_collection(target)?;
        OpenOptions::new()
            .write(true)
            .open(&target_db)?
            .sync_all()?;
        for folder in IMAGE_FOLDERS {
            fs::create_dir(target.join(folder))?;
            for (name, _) in image_files(&self.directory, folder)? {
                let bytes = artwork::read_checked_in(&self.directory, folder, &name)?;
                artwork::write_in(target, folder, &name, &bytes)?;
                if artwork::read_checked_in(target, folder, &name)? != bytes {
                    return Err(
                        format!("The copied image {name} did not match the original.").into(),
                    );
                }
            }
            sync_directory(&target.join(folder))?;
        }
        verify_references(&connection, target)?;
        sync_directory(target)?;
        sync_directory(&parent)?;

        let location = Location {
            directory: target.to_path_buf(),
            previous: self.directory.clone(),
        };
        save_location(
            &self.default_dir,
            &location,
            self.previous_location.is_some(),
        )?;
        // The pointer is committed. From here, do not remove the new collection or return an error.
        self.directory = staging.keep();
        self.previous_location = Some(location.previous);
        drop(source_lock);
        self.connection = connection;
        Ok(())
    }
}

fn checked_directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err("Choose an absolute directory without parent traversal.".into());
    }
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err("The selected path must be a directory, not a symbolic link.".into());
    }
    let canonical = dunce::canonicalize(path)?;
    if canonical.to_str().is_none() {
        return Err("The directory path must be valid Unicode.".into());
    }
    Ok(canonical)
}

fn checked_file(path: &Path) -> io::Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return Err(io::Error::other(format!(
            "Expected a regular file at {}.",
            path.display()
        )));
    }
    Ok(metadata)
}

fn read_location(default_dir: &Path) -> Result<Option<Location>> {
    let path = default_dir.join(LOCATION_FILE);
    match checked_file(&path) {
        Ok(_) => serde_json::from_reader::<_, Location>(File::open(&path)?).map(Some).map_err(|error| {
            format!("Could not read the saved storage location at {}: {error}. Restore the location file before restarting Hakoto.", path.display()).into()
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn save_location(default_dir: &Path, location: &Location, replace: bool) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(default_dir)?;
    serde_json::to_writer(&mut file, location)?;
    file.flush()?;
    file.as_file().sync_all()?;
    let path = default_dir.join(LOCATION_FILE);
    if replace {
        if read_location(default_dir)?.is_none_or(|current| current.directory != location.previous)
        {
            return Err(
                "The saved location changed outside Hakoto. Restart before trying again.".into(),
            );
        }
        file.persist(path)?;
    } else {
        file.persist_noclobber(path)?;
    }
    if let Err(error) = sync_directory(default_dir) {
        eprintln!("Could not sync the committed storage location: {error}");
    }
    Ok(())
}

fn open_saved_collection(directory: &Path) -> Result<Connection> {
    if checked_directory(directory)? != directory {
        return Err(
            "The saved collection directory no longer resolves to its original path.".into(),
        );
    }
    let path = directory.join(DATABASE_NAME);
    check_database_files(directory, true)?;
    if checked_file(&path)?.len() == 0 {
        return Err("The saved database is empty.".into());
    }
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection
        .prepare("SELECT id, title, artist, format, release_year, artwork, favorite FROM albums")?;
    profile::get(&connection)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    crate::database::migrate_album_columns(&transaction)?;
    transaction.commit()?;
    shelves::migrate(&mut connection)?;
    Ok(connection)
}

fn check_database_files(directory: &Path, required: bool) -> io::Result<()> {
    let database_exists = match checked_file(&directory.join(DATABASE_NAME)) {
        Ok(_) => true,
        Err(error) if !required && error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error),
    };
    for suffix in ["-wal", "-shm", "-journal"] {
        match checked_file(&directory.join(format!("{DATABASE_NAME}{suffix}"))) {
            Ok(_) if !database_exists => {
                return Err(io::Error::other(
                    "The SQLite database is missing but recovery files remain. Restore the database before restarting Hakoto.",
                ));
            }
            Ok(_) => (),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn image_files(directory: &Path, folder: &str) -> Result<Vec<(String, u64)>> {
    match fs::symlink_metadata(directory.join(folder)) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        result => {
            result?;
        }
    }
    let folder_path = artwork::directory_in(directory, folder)?;
    let mut images = Vec::new();
    for entry in fs::read_dir(folder_path)? {
        let entry = entry?;
        if let Ok(name) = entry.file_name().into_string()
            && artwork::is_filename(&name)
        {
            images.push((name, checked_file(&entry.path())?.len()));
        }
    }
    Ok(images)
}

fn image_bytes(directory: &Path, folder: &str) -> Result<u64> {
    Ok(image_files(directory, folder)?
        .into_iter()
        .map(|(_, size)| size)
        .sum())
}

fn check_space(source: &Connection, directory: &Path, parent: &Path) -> Result<()> {
    let page_count =
        u64::try_from(source.query_row("PRAGMA page_count", [], |row| row.get::<_, i64>(0))?)?;
    let page_size =
        u64::try_from(source.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))?)?;
    let block = fs4::allocation_granularity(parent)?.max(1);
    // Leave room for SQLite’s destination journal, block rounding, and directory metadata.
    let mut required = page_count
        .saturating_mul(page_size)
        .saturating_mul(2)
        .saturating_add(1024 * 1024);
    for folder in IMAGE_FOLDERS {
        for (_, size) in image_files(directory, folder)? {
            required = required.saturating_add(size.div_ceil(block).saturating_mul(block));
        }
    }
    let available = fs4::available_space(parent)?;
    if available < required {
        return Err(format!("Not enough free space in {}. Need at least {required} bytes; {available} bytes are available.", parent.display()).into());
    }
    Ok(())
}

fn verify_references(connection: &Connection, directory: &Path) -> Result<()> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT artwork, 'artwork' FROM albums WHERE artwork IS NOT NULL
         UNION ALL SELECT picture, 'profile-images' FROM profile WHERE picture IS NOT NULL
         UNION ALL SELECT artwork, 'artwork' FROM undo_albums WHERE artwork IS NOT NULL",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let folder: String = row.get(1)?;
        artwork::read_checked_in(directory, &folder, &name).map_err(|error| {
            format!("The collection references an unavailable image ({folder}/{name}): {error}. Repair or remove the reference before moving storage.")
        })?;
    }
    Ok(())
}

fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        artwork::TEST_WEBP,
        database::{Album, ArtworkChange},
    };

    fn album() -> Album {
        Album {
            id: "one".into(),
            title: "Test album".into(),
            artist: "Test artist".into(),
            format: "CD".into(),
            release_year: "2000".into(),
            artwork: None,
            favorite: true,
            pinned: false,
            date_added: None,
            condition: None,
            record_type: None,
            disc_size: None,
        }
    }

    fn locations() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let default = temp.path().join("default");
        let destination = temp.path().join("Custom storage");
        fs::create_dir(&destination).unwrap();
        (temp, default, destination)
    }

    fn add_cover(storage: &mut Storage) -> String {
        database::save_album(
            &mut storage.connection,
            &storage.directory,
            album(),
            Some(TEST_WEBP.to_vec()),
        )
        .unwrap()
        .artwork
        .unwrap()
    }

    #[test]
    fn usage_counts_sqlite_sidecars_and_managed_images_only() {
        let (_temp, default, _) = locations();
        let mut storage = Storage::open(&default, None).unwrap();
        storage
            .connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        add_cover(&mut storage);
        profile::set_picture(
            &mut storage.connection,
            &storage.directory,
            ArtworkChange::Replace(TEST_WEBP.to_vec()),
        )
        .unwrap();
        fs::write(
            storage.directory.join(ARTWORK_DIRECTORY).join("notes.txt"),
            b"unrelated",
        )
        .unwrap();
        let info = storage.info().unwrap();
        assert_eq!(info.database_path, storage.directory.join(DATABASE_NAME));
        assert_eq!(info.artwork_path, storage.directory.join(ARTWORK_DIRECTORY));
        let db_bytes: u64 = ["", "-wal", "-shm"]
            .into_iter()
            .map(|suffix| {
                fs::metadata(storage.directory.join(format!("{DATABASE_NAME}{suffix}")))
                    .unwrap()
                    .len()
            })
            .sum();
        assert_eq!(info.database_bytes, db_bytes);
        assert_eq!(info.artwork_bytes, TEST_WEBP.len() as u64);
        assert_eq!(info.profile_bytes, TEST_WEBP.len() as u64);
        assert_eq!(info.total_bytes, db_bytes + 2 * TEST_WEBP.len() as u64);
        assert!(info.is_default);
    }

    #[test]
    fn moves_a_live_wal_collection_and_restores_default_without_overwriting() {
        let (_temp, default, destination) = locations();
        let mut storage = Storage::open(&default, None).unwrap();
        assert!(Storage::open(&default, None).is_err());
        storage
            .connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        let cover = add_cover(&mut storage);
        let picture = profile::set_picture(
            &mut storage.connection,
            &storage.directory,
            ArtworkChange::Replace(TEST_WEBP.to_vec()),
        )
        .unwrap()
        .unwrap();
        profile::set_display_name(&storage.connection, "Original name").unwrap();
        assert!(
            fs::metadata(storage.directory.join("hakoto.db-wal"))
                .unwrap()
                .len()
                > 0
        );
        fs::write(destination.join(DATABASE_NAME), b"unrelated file").unwrap();
        storage.relocate(&destination).unwrap();
        let custom = storage.directory.clone();
        assert_eq!(
            custom.parent(),
            Some(dunce::canonicalize(&destination).unwrap().as_path())
        );
        assert_eq!(
            fs::read(destination.join(DATABASE_NAME)).unwrap(),
            b"unrelated file"
        );
        assert_eq!(artwork::read(&custom, &cover).as_deref(), Some(TEST_WEBP));
        assert_eq!(
            profile::read_image(&custom, &picture).as_deref(),
            Some(TEST_WEBP)
        );
        assert_eq!(
            database::get_albums(&storage.connection).unwrap()[0]
                .artwork
                .as_deref(),
            Some(cover.as_str())
        );
        assert!(database::get_albums(&storage.connection).unwrap()[0].favorite);
        profile::set_display_name(&storage.connection, "Updated at custom location").unwrap();
        drop(storage);

        let mut storage = Storage::open(&default, None).unwrap();
        assert_eq!(storage.directory, custom);
        assert!(!storage.info().unwrap().is_default);
        storage.relocate(&default).unwrap();
        let restored = storage.directory.clone();
        assert_ne!(restored, default);
        assert!(storage.info().unwrap().is_default);
        let original = Connection::open(default.join(DATABASE_NAME)).unwrap();
        assert_eq!(
            profile::get(&original).unwrap().display_name,
            "Original name"
        );
        drop(storage);
        let storage = Storage::open(&default, None).unwrap();
        assert_eq!(storage.directory, restored);
        assert_eq!(
            profile::get(&storage.connection).unwrap().display_name,
            "Updated at custom location"
        );
        assert_eq!(artwork::read(&restored, &cover).as_deref(), Some(TEST_WEBP));
    }

    #[test]
    fn failed_verification_or_location_write_rolls_back_without_switching() {
        let (_temp, default, destination) = locations();
        let mut storage = Storage::open(&default, None).unwrap();
        let cover = add_cover(&mut storage);
        let image = default.join(ARTWORK_DIRECTORY).join(&cover);
        fs::remove_file(&image).unwrap();
        let error = storage.relocate(&destination).unwrap_err();
        assert!(error.to_string().contains("unavailable image"), "{error}");
        assert!(!default.join(LOCATION_FILE).exists());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);

        fs::write(&image, TEST_WEBP).unwrap();
        let token = crate::undo::delete(&mut storage.connection, "one").unwrap();
        fs::remove_file(&image).unwrap();
        assert!(
            storage
                .relocate(&destination)
                .unwrap_err()
                .to_string()
                .contains("unavailable image")
        );
        assert_eq!(crate::undo::pending(&storage.connection).unwrap().len(), 1);
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        fs::write(&image, TEST_WEBP).unwrap();
        crate::undo::restore(&mut storage.connection, &storage.directory, &token).unwrap();
        fs::write(default.join(LOCATION_FILE), b"do not overwrite").unwrap();
        assert!(storage.relocate(&destination).is_err());
        assert_eq!(
            fs::read(default.join(LOCATION_FILE)).unwrap(),
            b"do not overwrite"
        );
        assert_eq!(storage.directory, dunce::canonicalize(&default).unwrap());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        assert_eq!(database::get_albums(&storage.connection).unwrap().len(), 1);
        assert_eq!(fs::read(image).unwrap(), TEST_WEBP);
    }

    #[test]
    fn refuses_invalid_destinations_and_never_recreates_a_missing_saved_database() {
        let (temp, default, destination) = locations();
        let mut storage = Storage::open(&default, None).unwrap();
        let nested = default.join("nested");
        fs::create_dir(&nested).unwrap();
        let file = temp.path().join("file");
        fs::write(&file, b"unrelated").unwrap();
        for invalid in [
            &default,
            &nested,
            &file,
            &destination.join("missing"),
            Path::new("relative"),
        ] {
            assert!(storage.relocate(invalid).is_err());
        }
        #[cfg(unix)]
        {
            let link = temp.path().join("link");
            std::os::unix::fs::symlink(&destination, &link).unwrap();
            assert!(storage.relocate(&link).is_err());
        }
        storage.relocate(&destination).unwrap();
        let saved_db = storage.directory.join(DATABASE_NAME);
        drop(storage);
        fs::remove_file(&saved_db).unwrap();
        let error = Storage::open(&default, None).err().unwrap();
        assert!(error.to_string().contains("Reconnect or repair"));
        assert!(!saved_db.exists());
        assert!(default.join(DATABASE_NAME).exists());
        fs::write(default.join(LOCATION_FILE), b"null").unwrap();
        assert!(Storage::open(&default, None).is_err());

        fs::remove_file(default.join(LOCATION_FILE)).unwrap();
        fs::remove_file(default.join(DATABASE_NAME)).unwrap();
        fs::write(default.join("hakoto.db-wal"), b"orphaned recovery data").unwrap();
        assert!(Storage::open(&default, None).is_err());
        assert!(!default.join(DATABASE_NAME).exists());
    }
}
