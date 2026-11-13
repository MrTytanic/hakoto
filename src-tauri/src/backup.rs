use std::{
    collections::HashMap,
    error::Error,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    artwork,
    database::{self, DATABASE_NAME},
    profile,
    storage::{self, IMAGE_FOLDERS, Storage},
};

const VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";
const SETTINGS: &str = "settings.json";
const RESTORE_PREFIX: &str = "hakoto-restored-";
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;
const MAX_SETTINGS: u64 = 16 * 1024;
const MAX_DATABASE: u64 = 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupSettings {
    theme: String,
    alphabetical_dividers: String,
    collection_view: String,
    collection_page_size: String,
    text_scale: String,
    animations: String,
    animation_duration: String,
}

impl BackupSettings {
    fn validate(&self) -> Result<()> {
        for (value, supported) in [
            (&self.theme, &["dark", "light", "system"][..]),
            (&self.alphabetical_dividers, &["off", "on"]),
            (&self.collection_view, &["grid", "list"]),
            (&self.collection_page_size, &["10", "25", "50", "100"]),
            (&self.text_scale, &["90", "100", "115", "130"]),
            (&self.animations, &["off", "on"]),
            (
                &self.animation_duration,
                &[
                    "100", "150", "200", "250", "300", "350", "400", "450", "500",
                ],
            ),
        ] {
            if !supported.contains(&value.as_str()) {
                return Err("The backup contains unsupported preferences.".into());
            }
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    name: String,
    bytes: u64,
    sha256: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format_version: u32,
    created_at: String,
    entries: Vec<Entry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub token: String,
    created_at: String,
    owned_albums: i64,
    wishlist_albums: i64,
    shelves: i64,
    crates: i64,
}

pub struct StagedRestore {
    pub summary: RestoreSummary,
    pub(crate) staging: TempDir,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSettings {
    restore_id: String,
    settings: BackupSettings,
    previous_location: PathBuf,
}

fn copy_hashed(reader: impl Read, mut writer: impl Write, bytes: u64) -> Result<String> {
    let mut reader = reader.take(bytes.checked_add(1).ok_or("Invalid archive entry size.")?);
    let mut buffer = [0; 64 * 1024];
    let mut hash = Sha256::new();
    let mut written = 0;
    loop {
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        written += size as u64;
        if written > bytes {
            return Err("A file is larger than its recorded size.".into());
        }
        hash.update(&buffer[..size]);
        writer.write_all(&buffer[..size])?;
    }
    if written != bytes {
        return Err("A file is shorter than its recorded size.".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn options(bytes: u64) -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(bytes >= u64::from(u32::MAX))
}

fn add_file<W: Write + io::Seek>(
    archive: &mut ZipWriter<W>,
    name: &str,
    reader: impl Read,
    bytes: u64,
) -> Result<Entry> {
    archive.start_file(name, options(bytes))?;
    let sha256 = copy_hashed(reader, archive, bytes)?;
    Ok(Entry {
        name: name.into(),
        bytes,
        sha256,
    })
}

pub fn export(storage: &Storage, path: &Path, settings: &BackupSettings) -> Result<()> {
    settings.validate()?;
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        return Err("Choose a backup filename ending in .zip.".into());
    }
    let path = storage::export_path(path)?;
    let parent = path.parent().unwrap();
    let snapshot = tempfile::tempdir_in(storage.default_dir())?;
    let database_path = snapshot.path().join(DATABASE_NAME);
    storage::snapshot_database(&storage.connection, &database_path)?;
    let connection = verify_database(&database_path, &storage.directory, storage.default_dir())?;
    let created_at =
        connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })?;
    drop(connection);

    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    let mut archive = ZipWriter::new(file.as_file_mut());
    let bytes = storage::checked_file(&database_path)?.len();
    validate_entry(DATABASE_NAME, bytes)?;
    let mut entries = vec![add_file(
        &mut archive,
        DATABASE_NAME,
        File::open(&database_path)?,
        bytes,
    )?];
    let settings = serde_json::to_vec(settings)?;
    entries.push(add_file(
        &mut archive,
        SETTINGS,
        settings.as_slice(),
        settings.len() as u64,
    )?);
    for folder in IMAGE_FOLDERS {
        for (name, _) in storage::image_files(&storage.directory, folder)? {
            if entries.len() >= MAX_ENTRIES - 1 {
                return Err("The collection has too many files for one backup.".into());
            }
            let bytes = artwork::read_checked_in(&storage.directory, folder, &name)?;
            entries.push(add_file(
                &mut archive,
                &format!("{folder}/{name}"),
                bytes.as_slice(),
                bytes.len() as u64,
            )?);
        }
    }
    let manifest = serde_json::to_vec(&Manifest {
        format_version: VERSION,
        created_at,
        entries,
    })?;
    if manifest.len() as u64 > MAX_MANIFEST {
        return Err("The backup manifest is too large.".into());
    }
    archive.start_file(MANIFEST, options(manifest.len() as u64))?;
    archive.write_all(&manifest)?;
    archive.finish()?.sync_all()?;
    file.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == io::ErrorKind::AlreadyExists {
            "A backup already exists at that location. Choose a new filename.".to_owned()
        } else {
            "Could not save the backup. Check the destination permissions.".to_owned()
        }
    })?;
    Ok(())
}

fn image_path(name: &str) -> Option<(&str, &str)> {
    let (folder, file) = name.split_once('/')?;
    (IMAGE_FOLDERS.contains(&folder) && artwork::is_filename(file)).then_some((folder, file))
}

fn validate_entry(name: &str, size: u64) -> Result<()> {
    match name {
        MANIFEST if (1..=MAX_MANIFEST).contains(&size) => Ok(()),
        SETTINGS if (1..=MAX_SETTINGS).contains(&size) => Ok(()),
        DATABASE_NAME if (512..=MAX_DATABASE).contains(&size) => Ok(()),
        DATABASE_NAME => Err("The backup database must be between 512 bytes and 1 GiB.".into()),
        _ if image_path(name).is_some() && (20..=artwork::MAX_BYTES as u64).contains(&size) => {
            Ok(())
        }
        _ => Err("The backup contains an invalid entry name or size.".into()),
    }
}

// Hakoto writes single-disk archives with no comments and a fixed-size ZIP64 footer.
// Check the entry count before ZipArchive allocates its central directory index.
fn central_directory(file: &mut File, size: u64) -> Result<(u64, u64, usize)> {
    let invalid = "The ZIP has an invalid central directory.";
    let footer_start = size.checked_sub(22).ok_or(invalid)?;
    file.seek(SeekFrom::Start(footer_start))?;
    let mut footer = [0; 22];
    file.read_exact(&mut footer)?;
    if &footer[..8] != b"PK\x05\x06\0\0\0\0" || footer[20..] != [0; 2] {
        return Err(invalid.into());
    }
    let count = u16::from_le_bytes(footer[10..12].try_into()?);
    if footer[8..10] != footer[10..12] {
        return Err(invalid.into());
    }
    let length = u32::from_le_bytes(footer[12..16].try_into()?);
    let start = u32::from_le_bytes(footer[16..20].try_into()?);
    let (start, length, count, end) =
        if count == u16::MAX || length == u32::MAX || start == u32::MAX {
            let end = footer_start.checked_sub(76).ok_or(invalid)?;
            file.seek(SeekFrom::Start(end))?;
            let mut footer64 = [0; 76];
            file.read_exact(&mut footer64)?;
            if &footer64[..4] != b"PK\x06\x06"
                || u64::from_le_bytes(footer64[4..12].try_into()?) != 44
                || footer64[16..24] != [0; 8]
                || footer64[24..32] != footer64[32..40]
                || &footer64[56..64] != b"PK\x06\x07\0\0\0\0"
                || u64::from_le_bytes(footer64[64..72].try_into()?) != end
                || footer64[72..76] != [1, 0, 0, 0]
            {
                return Err(invalid.into());
            }
            (
                u64::from_le_bytes(footer64[48..56].try_into()?),
                u64::from_le_bytes(footer64[40..48].try_into()?),
                u64::from_le_bytes(footer64[32..40].try_into()?),
                end,
            )
        } else {
            (
                u64::from(start),
                u64::from(length),
                u64::from(count),
                footer_start,
            )
        };
    // Our names and ZIP64 extra fields fit comfortably within 256 bytes per entry.
    if !(3..=MAX_ENTRIES as u64).contains(&count)
        || !(46 * count..=256 * count).contains(&length)
        || start.checked_add(length) != Some(end)
    {
        return Err(invalid.into());
    }
    Ok((start, end, count as usize))
}

pub fn stage(archive_path: &Path, parent: &Path) -> Result<StagedRestore> {
    storage::validate_selected_path(archive_path)?;
    storage::checked_file(archive_path)?;
    let mut headers = File::open(archive_path)?;
    let file_size = headers.metadata()?.len();
    let (central_start, central_end, count) = central_directory(&mut headers, file_size)?;
    let mut archive = ZipArchive::new(headers.try_clone()?)?;
    if archive.len() != count
        || archive.offset() != 0
        || archive.central_directory_start() != central_start
    {
        return Err("The ZIP has an invalid file layout.".into());
    }
    let mut contents = HashMap::new();
    let mut central = central_start;
    let mut next_local = 0;
    let mut total_bytes = 0u64;
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let name = std::str::from_utf8(file.name_raw())?;
        // The ZIP reader indexes entries by name. A gap exposes a duplicate central record
        // that the index may have discarded. Also require the original local name to match.
        if file.central_header_start() != central
            || file.header_start() != next_local
            || file.header_start() >= central_start
        {
            return Err("The ZIP has duplicate, overlapping, or misplaced entries.".into());
        }
        headers.seek(SeekFrom::Start(central + 28))?;
        let mut lengths = [0; 6];
        headers.read_exact(&mut lengths)?;
        central += 46
            + lengths
                .as_chunks::<2>()
                .0
                .iter()
                .map(|length| u64::from(u16::from_le_bytes(*length)))
                .sum::<u64>();
        headers.seek(SeekFrom::Start(file.header_start() + 26))?;
        let mut lengths = [0; 4];
        headers.read_exact(&mut lengths)?;
        let name_length = usize::from(u16::from_le_bytes([lengths[0], lengths[1]]));
        if name_length != name.len() {
            return Err("The ZIP has mismatched file names.".into());
        }
        let mut local_name = vec![0; name_length];
        headers.read_exact(&mut local_name)?;
        if local_name != name.as_bytes() {
            return Err("The ZIP has mismatched file names.".into());
        }
        next_local = file
            .data_start()
            .and_then(|start| start.checked_add(file.compressed_size()))
            .ok_or("Invalid ZIP data position.")?;
        validate_entry(name, file.size())?;
        if !file.is_file()
            || file.is_symlink()
            || file.encrypted()
            || file
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000))
            || file.compression() != CompressionMethod::Stored
            || file.compressed_size() != file.size()
        {
            return Err("The backup contains an unsupported ZIP entry.".into());
        }
        total_bytes = total_bytes
            .checked_add(file.size())
            .ok_or("Invalid total backup size.")?;
        contents.insert(name.to_owned(), (index, file.size()));
    }
    if total_bytes > file_size || next_local != central_start || central != central_end {
        return Err("The ZIP has an invalid file layout.".into());
    }
    let (manifest_index, manifest_bytes) = contents
        .remove(MANIFEST)
        .ok_or("The backup manifest is missing.")?;
    let mut manifest = Vec::new();
    copy_hashed(
        archive.by_index(manifest_index)?,
        &mut manifest,
        manifest_bytes,
    )?;
    let manifest: Manifest = serde_json::from_slice(&manifest)?;
    if manifest.format_version != VERSION {
        return Err(format!("Unsupported backup version {}.", manifest.format_version).into());
    }
    if !contents.contains_key(DATABASE_NAME)
        || !contents.contains_key(SETTINGS)
        || contents.len() != manifest.entries.len()
    {
        return Err("The backup contents do not match the manifest.".into());
    }
    let mut files = Vec::with_capacity(contents.len());
    for entry in manifest.entries {
        let (index, size) = contents
            .remove(&entry.name)
            .ok_or("A manifest entry is missing or duplicated.")?;
        if entry.bytes != size
            || entry.sha256.len() != 64
            || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(format!("Invalid integrity information for {}.", entry.name).into());
        }
        files.push((index, entry));
    }
    let block = fs4::allocation_granularity(parent)?.max(1);
    let required = files.iter().fold(1024 * 1024u64, |total, (_, entry)| {
        total.saturating_add(
            entry
                .bytes
                .div_ceil(block)
                .saturating_add(1)
                .saturating_mul(block),
        )
    });
    if fs4::available_space(parent)? < required {
        return Err("There is not enough free space to stage this backup.".into());
    }

    let staging = tempfile::Builder::new()
        .prefix(RESTORE_PREFIX)
        .tempdir_in(parent)?;
    for folder in IMAGE_FOLDERS {
        fs::create_dir(staging.path().join(folder))?;
    }
    for (index, entry) in files {
        let target = staging.path().join(&entry.name);
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        if copy_hashed(archive.by_index(index)?, &mut output, entry.bytes)? != entry.sha256 {
            return Err(format!("Integrity check failed for {}.", entry.name).into());
        }
        output.sync_all()?;
        drop(output);
        if let Some((folder, name)) = image_path(&entry.name) {
            artwork::read_checked_in(staging.path(), folder, name)?;
        }
    }
    for folder in IMAGE_FOLDERS {
        storage::sync_directory(&staging.path().join(folder))?;
    }
    read_settings(staging.path())?.validate()?;
    let connection = verify_database(&staging.path().join(DATABASE_NAME), staging.path(), parent)?;
    let date_valid: bool = connection.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', ?1) IS ?1",
        [&manifest.created_at],
        |row| row.get(0),
    )?;
    if !date_valid {
        return Err("The backup creation date is invalid.".into());
    }
    let (owned_albums, wishlist_albums) = connection.query_row(
        "SELECT count(*) FILTER (WHERE ownership = 'owned'),
                count(*) FILTER (WHERE ownership = 'wishlist') FROM albums",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let summary = RestoreSummary {
        token: restore_id(staging.path())?.to_owned(),
        created_at: manifest.created_at,
        owned_albums,
        wishlist_albums,
        shelves: connection.query_row("SELECT count(*) FROM shelves", [], |row| row.get(0))?,
        crates: connection.query_row("SELECT count(*) FROM crates", [], |row| row.get(0))?,
    };
    Ok(StagedRestore { summary, staging })
}

fn verify_database(database: &Path, directory: &Path, parent: &Path) -> Result<Connection> {
    let db = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.pragma_update(None, "trusted_schema", false)?;
    let reference = tempfile::tempdir_in(parent)?;
    let expected = database::initialize_database(reference.path(), None)?;
    if schema(&db)? != schema(&expected)? || album_columns(&db)? != album_columns(&expected)? {
        return Err("The backup database schema is unsupported or has been modified.".into());
    }
    storage::verify_database_integrity(&db)?;
    database::verify_album_rows(&db)?;
    profile::get(&db)?;
    crate::undo::pending(&db)?;
    let invalid_placement: bool = db.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM shelf_placements AS p JOIN shelves AS s ON s.id = p.shelf_id
            JOIN albums AS a ON a.id = p.album_id
            WHERE p.row_index >= s.rows OR p.column_index >= s.columns OR a.ownership <> 'owned'
            UNION ALL SELECT 1 FROM crate_albums AS c JOIN albums AS a ON a.id = c.album_id
            WHERE a.ownership <> 'owned'
        )",
        [],
        |row| row.get(0),
    )?;
    if invalid_placement {
        return Err("The backup contains invalid shelf placements or crate memberships.".into());
    }
    storage::verify_references(&db, directory)?;
    Ok(db)
}

type SchemaObject = (String, String, String, String);

fn schema(connection: &Connection) -> rusqlite::Result<Vec<SchemaObject>> {
    let mut statement = connection.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name")?;
    statement
        .query_map([], |row| {
            let kind: String = row.get(0)?;
            let name: String = row.get(1)?;
            let sql: String = row.get(3)?;
            // Album table formatting can differ across legacy migrations. Compare its columns separately.
            let definition = if kind == "table"
                && name == "albums"
                && sql
                    .trim_start()
                    .to_ascii_uppercase()
                    .starts_with("CREATE TABLE ")
            {
                String::new()
            } else {
                sql
            };
            Ok((kind, name, row.get(2)?, definition))
        })?
        .collect()
}

type Column = (String, String, bool, Option<String>, i64, i64);

fn album_columns(connection: &Connection) -> rusqlite::Result<Vec<Column>> {
    let mut statement = connection.prepare("SELECT name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo('albums') ORDER BY name")?;
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .collect()
}

fn restore_id(directory: &Path) -> Result<&str> {
    directory
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.starts_with(RESTORE_PREFIX))
        .ok_or_else(|| "Invalid restore staging location.".into())
}

fn read_settings(directory: &Path) -> Result<BackupSettings> {
    let path = directory.join(SETTINGS);
    if storage::checked_file(&path)?.len() > MAX_SETTINGS {
        return Err("The backup preferences are too large.".into());
    }
    Ok(serde_json::from_reader(
        File::open(path)?.take(MAX_SETTINGS + 1),
    )?)
}

pub fn pending_settings(storage: &Storage) -> Result<Option<PendingSettings>> {
    let Ok(restore_id) = restore_id(&storage.directory) else {
        return Ok(None);
    };
    match storage::checked_file(&storage.directory.join(SETTINGS)) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let settings = read_settings(&storage.directory)?;
    settings.validate()?;
    let previous_location = storage
        .previous_location()
        .ok_or("The previous collection location is unavailable.")?
        .to_path_buf();
    Ok(Some(PendingSettings {
        restore_id: restore_id.to_owned(),
        settings,
        previous_location,
    }))
}

pub fn finish_settings(storage: &Storage, token: &str) -> Result<()> {
    if restore_id(&storage.directory)? != token {
        return Err("This restore is no longer active.".into());
    }
    let marker = storage.directory.join(SETTINGS);
    storage::checked_file(&marker)?;
    fs::remove_file(marker)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shelves;

    fn settings() -> BackupSettings {
        serde_json::from_value(serde_json::json!({
            "theme": "light", "alphabeticalDividers": "on", "collectionView": "list",
            "collectionPageSize": "50", "textScale": "115", "animations": "off",
            "animationDuration": "350"
        }))
        .unwrap()
    }

    #[test]
    fn backup_rejects_oversized_entries_and_zip64_indexes_before_staging() {
        assert!(validate_entry(DATABASE_NAME, MAX_DATABASE + 1).is_err());
        let workspace = tempfile::tempdir().unwrap();
        let path = workspace.path().join("oversized.zip");
        let mut file = File::create(&path).unwrap();
        let count = MAX_ENTRIES as u64 + 1;
        let directory_size = count * 46;
        file.seek(SeekFrom::Start(directory_size)).unwrap();
        file.write_all(b"PK\x06\x06").unwrap();
        file.write_all(&44u64.to_le_bytes()).unwrap();
        file.write_all(&[0; 12]).unwrap();
        for value in [count, count, directory_size, 0] {
            file.write_all(&value.to_le_bytes()).unwrap();
        }
        file.write_all(b"PK\x06\x07\0\0\0\0").unwrap();
        file.write_all(&directory_size.to_le_bytes()).unwrap();
        file.write_all(&1u32.to_le_bytes()).unwrap();
        file.write_all(b"PK\x05\x06\0\0\0\0").unwrap();
        file.write_all(&[0xff; 8]).unwrap();
        file.write_all(&[0; 6]).unwrap();
        drop(file);

        let error = stage(&path, workspace.path()).err().unwrap().to_string();
        assert_eq!(error, "The ZIP has an invalid central directory.");
        assert_eq!(fs::read_dir(workspace.path()).unwrap().count(), 1);
    }

    #[test]
    fn restores_wal_snapshot_images_settings_and_references_at_another_location() {
        let workspace = tempfile::tempdir().unwrap();
        let source = workspace.path().join("Original collection – 日本語");
        let mut storage = Storage::open(&source, None).unwrap();
        let image = "0123456789abcdef0123456789abcdef.webp";
        artwork::write(&storage.directory, image, artwork::TEST_WEBP).unwrap();
        let picture = profile::set_picture(
            &mut storage.connection,
            &storage.directory,
            database::ArtworkChange::Replace(artwork::TEST_WEBP.to_vec()),
        )
        .unwrap()
        .unwrap();
        profile::set_display_name(&storage.connection, "Björk").unwrap();
        storage
            .connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
             INSERT INTO albums (id,title,artist,format,ownership,artwork) VALUES
              ('owned','Album','Artist','CD','owned','0123456789abcdef0123456789abcdef.webp'),
              ('wish','Wishlist','Artist','','wishlist',NULL);
             INSERT INTO shelves VALUES (3,'Shelf',1,1,'vertical');
             INSERT INTO shelf_placements VALUES (3,0,0,'owned');
             INSERT INTO crates VALUES (7,'Crate',NULL);
             INSERT INTO crate_albums VALUES (7,'owned',0);",
            )
            .unwrap();
        let zip = workspace.path().join("Backup – 日本語.ZIP");
        export(&storage, &zip, &settings()).unwrap();
        assert!(export(&storage, &zip, &settings()).is_err());
        drop(storage);
        fs::rename(source, workspace.path().join("moved")).unwrap();

        let destination = workspace.path().join("Restored collection – 日本語");
        let mut storage = Storage::open(&destination, None).unwrap();
        storage.connection.execute("INSERT INTO albums (id,title,artist,format) VALUES ('owned','Original title with conflicting ID','Artist','CD')", []).unwrap();
        let staged = stage(&zip, storage.default_dir()).unwrap();
        let token = staged.summary.token;
        assert_eq!(
            (
                staged.summary.owned_albums,
                staged.summary.wishlist_albums,
                staged.summary.shelves,
                staged.summary.crates
            ),
            (1, 1, 1, 1)
        );
        assert_eq!(
            database::get_album(&storage.connection, "owned")
                .unwrap()
                .unwrap()
                .title,
            "Original title with conflicting ID"
        );
        storage.activate_restored(staged.staging).unwrap();
        assert_eq!(
            storage.previous_location(),
            Some(dunce::canonicalize(&destination).unwrap().as_path())
        );
        drop(storage);

        let mut storage = Storage::open(&destination, None).unwrap();
        let pending = pending_settings(&storage).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(pending.settings).unwrap(),
            serde_json::to_value(settings()).unwrap()
        );
        assert_eq!(pending.restore_id, token);
        let owned = database::get_album(&storage.connection, "owned")
            .unwrap()
            .unwrap();
        assert_eq!(owned.artwork.as_deref(), Some(image));
        assert_eq!(owned.title, "Album");
        let wishlist = database::get_album(&storage.connection, "wish")
            .unwrap()
            .unwrap();
        assert_eq!(wishlist.ownership, database::Ownership::Wishlist);
        assert_eq!(
            profile::get(&storage.connection).unwrap().display_name,
            "Björk"
        );
        assert_eq!(
            artwork::read(&storage.directory, image).unwrap(),
            artwork::TEST_WEBP
        );
        assert_eq!(
            profile::read_image(&storage.directory, &picture).unwrap(),
            artwork::TEST_WEBP
        );
        assert_eq!(
            shelves::load_shelf(&mut storage.connection, 3)
                .unwrap()
                .placements[0]
                .album_id,
            "owned"
        );
        let member: String = storage
            .connection
            .query_row(
                "SELECT album_id FROM crate_albums WHERE crate_id = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(member, "owned");
        finish_settings(&storage, &token).unwrap();
        assert!(pending_settings(&storage).unwrap().is_none());
        let original = Connection::open(destination.join(DATABASE_NAME)).unwrap();
        assert_eq!(
            database::get_album(&original, "owned")
                .unwrap()
                .unwrap()
                .title,
            "Original title with conflicting ID"
        );
    }

    #[test]
    fn restores_an_empty_collection_and_retains_the_previous_collection() {
        let workspace = tempfile::tempdir().unwrap();
        let source = Storage::open(&workspace.path().join("empty"), None).unwrap();
        let zip = workspace.path().join("empty.zip");
        export(&source, &zip, &settings()).unwrap();

        let destination = workspace.path().join("populated");
        let mut storage = Storage::open(&destination, None).unwrap();
        storage
            .connection
            .execute(
                "INSERT INTO albums (id,title,artist,format) VALUES ('keep','Keep','Artist','CD')",
                [],
            )
            .unwrap();
        let staged = stage(&zip, storage.default_dir()).unwrap();
        assert_eq!(
            (
                staged.summary.owned_albums,
                staged.summary.wishlist_albums,
                staged.summary.shelves,
                staged.summary.crates
            ),
            (0, 0, 0, 0)
        );
        storage.activate_restored(staged.staging).unwrap();
        drop(storage);

        let restored = Storage::open(&destination, None).unwrap();
        assert!(
            database::get_albums(&restored.connection)
                .unwrap()
                .is_empty()
        );
        assert!(restored.directory.join("artwork").is_dir());
        assert!(restored.directory.join("profile-images").is_dir());
        let previous =
            Connection::open(restored.previous_location().unwrap().join(DATABASE_NAME)).unwrap();
        assert!(database::get_album(&previous, "keep").unwrap().is_some());
    }

    #[test]
    fn failed_activation_keeps_the_previous_location_and_collection_after_restart() {
        let workspace = tempfile::tempdir().unwrap();
        let default = workspace.path().join("default");
        let destination = workspace.path().join("destination");
        fs::create_dir(&destination).unwrap();
        let mut storage = Storage::open(&default, None).unwrap();
        let image = "0123456789abcdef0123456789abcdef.webp";
        artwork::write(&storage.directory, image, artwork::TEST_WEBP).unwrap();
        storage.connection.execute(
            "INSERT INTO albums (id,title,artist,format,artwork) VALUES ('backup','Album','Artist','CD',?1)",
            [image],
        ).unwrap();
        let zip = workspace.path().join("backup.zip");
        export(&storage, &zip, &settings()).unwrap();
        storage.relocate(&destination).unwrap();
        let active = storage.directory.clone();
        storage
            .connection
            .execute(
                "UPDATE albums SET title = 'Current title' WHERE id = 'backup'",
                [],
            )
            .unwrap();
        let staged = stage(&zip, storage.default_dir()).unwrap();
        let staging_path = staged.staging.path().to_owned();
        fs::remove_file(staging_path.join("artwork").join(image)).unwrap();
        assert!(storage.activate_restored(staged.staging).is_err());
        assert_eq!(storage.directory, active);
        assert!(!staging_path.exists());
        drop(storage);

        let storage = Storage::open(&default, None).unwrap();
        assert_eq!(storage.directory, active);
        assert_eq!(
            database::get_album(&storage.connection, "backup")
                .unwrap()
                .unwrap()
                .title,
            "Current title"
        );
        assert_eq!(
            artwork::read(&storage.directory, image).as_deref(),
            Some(artwork::TEST_WEBP)
        );
    }

    #[test]
    fn rejects_invalid_archives_before_switching_storage() {
        let workspace = tempfile::tempdir().unwrap();
        let mut storage = Storage::open(&workspace.path().join("collection"), None).unwrap();
        let valid = workspace.path().join("valid.zip");
        export(&storage, &valid, &settings()).unwrap();
        let mut archive = ZipArchive::new(File::open(&valid).unwrap()).unwrap();
        let mut manifest_data = Vec::new();
        archive
            .by_name(MANIFEST)
            .unwrap()
            .read_to_end(&mut manifest_data)
            .unwrap();
        let original: Manifest = serde_json::from_slice(&manifest_data).unwrap();
        let invalid = workspace.path().join("invalid.zip");
        fs::write(&invalid, b"not a zip").unwrap();
        assert!(stage(&invalid, storage.default_dir()).is_err());
        for issue in [
            "version",
            "hash",
            "traversal",
            "windows-traversal",
            "drive-path",
            "symlink",
            "size",
        ] {
            let mut manifest: Manifest = serde_json::from_slice(&manifest_data).unwrap();
            let mut zip = ZipWriter::new(File::create(&invalid).unwrap());
            for entry in &original.entries {
                zip.start_file(&entry.name, options(entry.bytes)).unwrap();
                io::copy(&mut archive.by_name(&entry.name).unwrap(), &mut zip).unwrap();
            }
            match issue {
                "version" => manifest.format_version += 1,
                "hash" => manifest.entries[0].sha256 = "0".repeat(64),
                "traversal" => {
                    zip.start_file("../outside", options(1)).unwrap();
                    zip.write_all(b"x").unwrap();
                }
                "windows-traversal" | "drive-path" => {
                    let name = if issue == "drive-path" {
                        r"C:\outside"
                    } else {
                        r"artwork\..\outside"
                    };
                    zip.start_file(name, options(1)).unwrap();
                    zip.write_all(b"x").unwrap();
                }
                "symlink" => zip
                    .add_symlink(
                        "artwork/0123456789abcdef0123456789abcdef.webp",
                        "../../outside-collection",
                        options(24),
                    )
                    .unwrap(),
                "size" => manifest.entries[0].bytes += 1,
                _ => unreachable!(),
            }
            zip.start_file(MANIFEST, options(0)).unwrap();
            serde_json::to_writer(&mut zip, &manifest).unwrap();
            zip.finish().unwrap();
            assert!(stage(&invalid, storage.default_dir()).is_err(), "{issue}");
        }
        assert!(!workspace.path().join("outside").exists());
        let staged = stage(&valid, storage.default_dir()).unwrap();
        let staging_path = staged.staging.path().to_owned();
        fs::write(
            storage.default_dir().join("storage-location.json"),
            b"foreign pointer",
        )
        .unwrap();
        let old_path = storage.directory.clone();
        assert!(storage.activate_restored(staged.staging).is_err());
        assert_eq!(storage.directory, old_path);
        assert!(!staging_path.exists());
        assert_eq!(
            fs::read(storage.default_dir().join("storage-location.json")).unwrap(),
            b"foreign pointer"
        );
        assert!(
            database::get_albums(&storage.connection)
                .unwrap()
                .is_empty()
        );
    }
}
