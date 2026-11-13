use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{self, BufWriter, Read, Write},
    path::Path,
};

use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;

use crate::{
    database::{self, Album, Ownership},
    metadata, storage,
};

const VERSION_COLUMN: &str = "hakoto_csv_version";
const HEADERS: [&str; 16] = [
    VERSION_COLUMN,
    "id",
    "title",
    "artist",
    "format",
    "ownership",
    "release_year",
    "original_release_year",
    "condition",
    "notes",
    "date_added",
    "date_acquired",
    "favorite",
    "pinned",
    "record_type",
    "disc_size",
];
const MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_RECORDS: usize = 50_000;
type Result<T> = std::result::Result<T, String>;

fn spreadsheet_escape(value: &str) -> bool {
    let trimmed = value
        .trim_start_matches(|ch: char| ch.is_whitespace() || ch.is_control() || ch == '\u{feff}');
    value.starts_with(['\'', '\t', '\r', '\n'])
        || trimmed.starts_with(['=', '+', '-', '@', '＝', '＋', '－', '＠'])
}

fn write_record(mut writer: impl Write, fields: &[&str], protect: bool) -> io::Result<()> {
    for (index, value) in fields.iter().enumerate() {
        if index > 0 {
            writer.write_all(b",")?;
        }
        writer.write_all(b"\"")?;
        if protect && spreadsheet_escape(value) {
            writer.write_all(b"'")?;
        }
        writer.write_all(value.replace('"', "\"\"").as_bytes())?;
        writer.write_all(b"\"")?;
    }
    writer.write_all(b"\r\n")
}

fn write_albums(
    mut writer: impl Write,
    albums: impl Iterator<Item = rusqlite::Result<Album>>,
) -> Result<usize> {
    write_record(&mut writer, &HEADERS, false)
        .map_err(|_| "Could not write the CSV. Check available disk space.")?;
    let mut count = 0;
    for album in albums {
        let album = album.map_err(database::database_error)?;
        write_record(
            &mut writer,
            &[
                "1",
                &album.id,
                &album.title,
                &album.artist,
                &album.format,
                album.ownership.as_str(),
                &album
                    .release_year
                    .map(|year| year.to_string())
                    .unwrap_or_default(),
                &album
                    .original_release_year
                    .map(|year| year.to_string())
                    .unwrap_or_default(),
                album.condition.as_deref().unwrap_or_default(),
                album.notes.as_deref().unwrap_or_default(),
                album.date_added.as_deref().unwrap_or_default(),
                album.date_acquired.as_deref().unwrap_or_default(),
                if album.favorite { "true" } else { "false" },
                if album.pinned { "true" } else { "false" },
                album.record_type.as_deref().unwrap_or_default(),
                album.disc_size.as_deref().unwrap_or_default(),
            ],
            true,
        )
        .map_err(|_| "Could not write the CSV. Check available disk space.")?;
        count += 1;
    }
    Ok(count)
}

pub fn export(path: &Path, connection: &Connection, include_wishlist: bool) -> Result<usize> {
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("csv"))
    {
        return Err("Choose a file name ending in .csv.".into());
    }
    let path = storage::export_path(path)?;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|_| "Could not create the CSV. Check the destination permissions.")?;
    let count = {
        let mut writer = BufWriter::new(&mut file);
        let mut statement = connection.prepare(&format!(
            "SELECT * FROM (SELECT {} FROM albums WHERE ownership = 'owned' ORDER BY rowid)
             UNION ALL
             SELECT * FROM (SELECT {} FROM albums WHERE ?1 AND ownership = 'wishlist' ORDER BY rowid)",
            database::ALBUM_COLUMNS, database::ALBUM_COLUMNS,
        )).map_err(database::database_error)?;
        let albums = statement
            .query_map([include_wishlist], database::read_album)
            .map_err(database::database_error)?;
        let count = write_albums(&mut writer, albums)?;
        writer
            .flush()
            .map_err(|_| "Could not write the CSV. Check available disk space.")?;
        count
    };
    file.as_file()
        .sync_all()
        .map_err(|_| "Could not finish writing the CSV. Check the destination and try again.")?;
    file.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == io::ErrorKind::AlreadyExists {
            "A file already exists at that location. Choose a new CSV filename."
        } else {
            "Could not save the CSV. Check the destination permissions."
        }
    })?;
    Ok(count)
}

#[derive(PartialEq, Eq)]
enum Field {
    Start,
    Unquoted,
    Quoted,
    AfterQuote,
}

fn parse(text: &str) -> Result<Vec<Vec<String>>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut value = String::new();
    let mut field = Field::Start;
    let mut input = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text)
        .chars()
        .peekable();
    while let Some(ch) = input.next() {
        match (field, ch) {
            (Field::Quoted, '"') => field = Field::AfterQuote,
            (Field::Quoted, ch) => {
                value.push(ch);
                field = Field::Quoted;
            }
            (Field::AfterQuote, '"') => {
                value.push('"');
                field = Field::Quoted;
            }
            (Field::Start, '"') => field = Field::Quoted,
            (_, ',' | '\n' | '\r') => {
                record.push(std::mem::take(&mut value));
                if ch != ',' {
                    if ch == '\r' && input.peek() == Some(&'\n') {
                        input.next();
                    }
                    records.push(std::mem::take(&mut record));
                    if records.len() > MAX_RECORDS + 1 {
                        return Err("The CSV contains more than 50,000 album records.".into());
                    }
                } else if record.len() >= HEADERS.len() {
                    return Err(format!(
                        "CSV record {} has too many columns.",
                        records.len() + 1
                    ));
                }
                field = Field::Start;
            }
            (Field::AfterQuote, _) | (Field::Unquoted, '"') => {
                return Err(format!(
                    "CSV record {} has invalid quotation marks.",
                    records.len() + 1
                ));
            }
            (_, ch) => {
                value.push(ch);
                field = Field::Unquoted;
            }
        }
    }
    if field == Field::Quoted {
        return Err(format!(
            "CSV record {} has an unclosed quoted field.",
            records.len() + 1
        ));
    }
    if !record.is_empty() || field != Field::Start {
        record.push(value);
        records.push(record);
    }
    if records.len() > MAX_RECORDS + 1 {
        return Err("The CSV contains more than 50,000 album records.".into());
    }
    Ok(records)
}

pub fn read(path: &Path) -> Result<String> {
    storage::validate_selected_path(path)?;
    let metadata =
        storage::checked_file(path).map_err(|_| "Choose an accessible, regular CSV file.")?;
    if metadata.len() > MAX_BYTES {
        return Err("The CSV must be 32 MB or smaller.".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| "Could not read the CSV. Check that the file is accessible.")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("The CSV must be 32 MB or smaller.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The CSV must use UTF-8 encoding.".into())
}

#[derive(Clone, Serialize)]
pub struct PreviewRow {
    record: usize,
    title: String,
    artist: String,
    format: String,
    ownership: String,
    duplicate: bool,
    error: Option<String>,
}

pub struct PreparedImport {
    rows: Vec<(PreviewRow, Option<Album>)>,
}

impl PreparedImport {
    pub fn preview(&self) -> Vec<PreviewRow> {
        self.rows
            .iter()
            .map(|(preview, _)| preview.clone())
            .collect()
    }
}

fn duplicate_key(title: &str, artist: &str, format: &str) -> (String, String, String) {
    fn normalize(value: &str) -> String {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    }
    (normalize(title), normalize(artist), normalize(format))
}

#[derive(Default)]
struct Existing {
    ids: HashSet<String>,
    keys: HashSet<(String, String, String)>,
}

impl Existing {
    fn load(connection: &Connection) -> rusqlite::Result<Self> {
        let mut existing = Self::default();
        let mut albums = connection.prepare("SELECT id, title, artist, format FROM albums")?;
        let mut rows = albums.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            if !id.is_empty() {
                existing.ids.insert(id);
            }
            existing.keys.insert(duplicate_key(
                row.get_ref(1)?.as_str()?,
                row.get_ref(2)?.as_str()?,
                row.get_ref(3)?.as_str()?,
            ));
        }
        let mut statement = connection.prepare(
            "SELECT json_extract(payload, '$.album.id') FROM undo_albums WHERE json_valid(payload)",
        )?;
        for id in statement.query_map([], |row| row.get::<_, Option<String>>(0))? {
            if let Some(id) = id? {
                existing.ids.insert(id);
            }
        }
        Ok(existing)
    }

    fn duplicate(&self, album: &Album) -> bool {
        self.ids.contains(&album.id)
            || self
                .keys
                .contains(&duplicate_key(&album.title, &album.artist, &album.format))
    }

    fn track(&mut self, album: &Album) {
        if !album.id.is_empty() {
            self.ids.insert(album.id.clone());
        }
        self.keys
            .insert(duplicate_key(&album.title, &album.artist, &album.format));
    }
}

fn year(value: &str, field: &str) -> Result<Option<u16>> {
    if value.is_empty() {
        return Ok(None);
    }
    if value.bytes().all(|byte| byte.is_ascii_digit())
        && let Ok(year @ 1..=9999) = value.parse::<u16>()
    {
        return Ok(Some(year));
    }
    Err(format!("{field} must be a whole year from 1 to 9999."))
}

fn boolean(value: &str, field: &str) -> Result<bool> {
    match value.to_ascii_lowercase().as_str() {
        "" | "0" | "false" => Ok(false),
        "1" | "true" => Ok(true),
        _ => Err(format!("{field} must be true or false.")),
    }
}

pub fn prepare(connection: &Connection, text: &str) -> Result<PreparedImport> {
    let mut records = parse(text)?.into_iter();
    let headers = records.next().ok_or("The CSV is empty.")?;
    let mut columns = HashMap::new();
    for (index, header) in headers.iter().enumerate() {
        let header = header.trim().to_ascii_lowercase();
        if !HEADERS.contains(&header.as_str()) {
            return Err(format!("Unknown CSV column “{header}”."));
        }
        if columns.insert(header.clone(), index).is_some() {
            return Err(format!("CSV column “{header}” appears more than once."));
        }
    }
    for required in ["title", "artist", "format"] {
        if !columns.contains_key(required) {
            return Err(format!(
                "The CSV is missing the required “{required}” column."
            ));
        }
    }
    let own_format = columns.contains_key(VERSION_COLUMN);
    let mut existing = Existing::load(connection).map_err(database::database_error)?;
    let mut rows = Vec::new();
    for (index, fields) in records.enumerate() {
        if fields.len() == 1 && fields[0].trim().is_empty() {
            continue;
        }
        let cell = |name: &str| -> &str {
            let value = columns
                .get(name)
                .and_then(|index| fields.get(*index))
                .map(String::as_str)
                .unwrap_or_default();
            if own_format
                && let Some(unescaped) = value.strip_prefix('\'')
                && spreadsheet_escape(unescaped)
            {
                unescaped
            } else {
                value
            }
        };
        let mut preview = PreviewRow {
            record: index + 2,
            title: cell("title").to_owned(),
            artist: cell("artist").to_owned(),
            format: cell("format").to_owned(),
            ownership: cell("ownership").trim().to_owned(),
            duplicate: false,
            error: None,
        };
        let album = (|| {
            if fields.len() != headers.len() {
                return Err(format!(
                    "Expected {} columns, found {}.",
                    headers.len(),
                    fields.len()
                ));
            }
            if own_format && cell(VERSION_COLUMN) != "1" {
                return Err("Unsupported Hakoto CSV version.".into());
            }
            let optional = |name: &str| (!cell(name).is_empty()).then(|| cell(name).to_owned());
            let ownership = match cell("ownership").trim().to_ascii_lowercase().as_str() {
                "" | "owned" => Ownership::Owned,
                "wishlist" => Ownership::Wishlist,
                _ => return Err("Ownership must be owned or wishlist.".into()),
            };
            let mut album = Album {
                id: optional("id").unwrap_or_else(|| "import-preview".into()),
                title: preview.title.clone(),
                artist: preview.artist.clone(),
                format: preview.format.clone(),
                ownership,
                release_year: year(cell("release_year").trim(), "Release year")?,
                original_release_year: year(
                    cell("original_release_year").trim(),
                    "Original release year",
                )?,
                artwork: None,
                condition: optional("condition"),
                notes: optional("notes"),
                date_added: optional("date_added"),
                date_acquired: optional("date_acquired"),
                favorite: boolean(cell("favorite").trim(), "Favorite")?,
                pinned: boolean(cell("pinned").trim(), "Pinned")?,
                record_type: optional("record_type"),
                disc_size: optional("disc_size"),
            };
            if let Some(date) = &album.date_added {
                metadata::validate_acquisition_date(connection, date)
                    .map_err(|_| "Date added must be a valid date (YYYY-MM-DD).")?;
            }
            metadata::validate(connection, &mut album, None)?;
            if cell("id").is_empty() {
                album.id.clear();
            }
            Ok(album)
        })();
        let album = match album {
            Ok(album) => {
                preview.title = album.title.clone();
                preview.artist = album.artist.clone();
                preview.format = album.format.clone();
                preview.ownership = album.ownership.as_str().to_owned();
                preview.duplicate = existing.duplicate(&album);
                existing.track(&album);
                Some(album)
            }
            Err(error) => {
                preview.error = Some(error);
                None
            }
        };
        rows.push((preview, album));
    }
    Ok(PreparedImport { rows })
}

pub fn import(
    connection: &mut Connection,
    prepared: &PreparedImport,
    import_duplicates: &[usize],
) -> Result<Vec<Album>> {
    let approved: HashSet<_> = import_duplicates.iter().copied().collect();
    let duplicates = prepared
        .rows
        .iter()
        .filter_map(|(row, _)| row.duplicate.then_some(row.record))
        .collect();
    if !approved.is_subset(&duplicates) {
        return Err("The duplicate choices do not match this preview.".into());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database::database_error)?;
    let mut existing = Existing::load(&transaction).map_err(database::database_error)?;
    let mut imported = Vec::new();
    for (preview, album) in &prepared.rows {
        let Some(album) = album else {
            continue;
        };
        let allow_duplicate = approved.contains(&preview.record);
        if preview.duplicate && !allow_duplicate {
            continue;
        }
        if existing.duplicate(album) && !allow_duplicate {
            return Err(format!(
                "Record {} now matches an album in your collection. Preview the CSV again before importing.",
                preview.record
            ));
        }
        let mut album = album.clone();
        while album.id.is_empty() || existing.ids.contains(&album.id) {
            album.id = transaction
                .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
                .map_err(database::database_error)?;
        }
        if database::write_album(&transaction, database::INSERT_ALBUM, &album).map_err(|error| {
            format!(
                "Could not import record {}. No albums were imported. {}",
                preview.record,
                database::database_error(error)
            )
        })? != 1
        {
            return Err(format!(
                "Could not import record {}. No albums were imported.",
                preview.record
            ));
        }
        existing.track(&album);
        imported.push(album);
    }
    transaction.commit().map_err(database::database_error)?;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_preserves_existing_files_and_import_rejects_oversized_input() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("collection.csv");
        std::fs::write(&path, b"existing file").unwrap();
        let db = database::initialize_database(directory.path(), None).unwrap();
        assert!(
            export(&path, &db, false)
                .unwrap_err()
                .contains("already exists")
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"existing file");

        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert!(read(&path).unwrap_err().contains("32 MB"));
    }

    #[cfg(unix)]
    #[test]
    fn csv_import_and_export_refuse_symbolic_links() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original.csv");
        let link = directory.path().join("link.csv");
        std::fs::write(&original, b"original").unwrap();
        std::os::unix::fs::symlink(&original, &link).unwrap();
        assert!(read(&link).is_err());
        let db = database::initialize_database(directory.path(), None).unwrap();
        assert!(export(&link, &db, false).is_err());
        assert_eq!(std::fs::read(&original).unwrap(), b"original");
        assert!(link.symlink_metadata().unwrap().is_symlink());
    }

    #[test]
    fn empty_collection_export_is_a_valid_no_op_import() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        let path = directory.path().join("Empty collection – 日本語.CSV");
        assert_eq!(export(&path, &db, true).unwrap(), 0);
        let preview = prepare(&db, &read(&path).unwrap()).unwrap();
        assert!(preview.preview().is_empty());
        assert!(import(&mut db, &preview, &[]).unwrap().is_empty());
        assert!(prepare(&db, "").is_err());
    }

    #[test]
    fn export_round_trips_utf8_quotes_multiline_metadata_and_formula_escaping() {
        let source = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(source.path(), None).unwrap();
        let input = "id,title,artist,format,ownership,release_year,original_release_year,condition,notes,date_added,date_acquired,favorite,pinned,record_type,disc_size\r\n\
            @copy,\"=1+1, \"\"Édition\"\"\",'Björk,Vinyl,owned,2020,1999,Mint,\"\t=2+2\nLine, \"\"two\"\"\",2026-01-02,2024-02-29,true,true,LP,12\r\n\
            wish,＋Song,Artist,,wishlist,,,,,2026-02-01,,false,false,,\r\n";
        let preview = prepare(&db, input).unwrap();
        assert!(preview.preview().iter().all(|row| row.error.is_none()));
        let saved = import(&mut db, &preview, &[]).unwrap();

        let file = source.path().join("collection.csv");
        assert_eq!(export(&file, &db, false).unwrap(), 1);
        assert!(!read(&file).unwrap().contains("＋Song"));
        let file = source.path().join("collection-with-wishlist.csv");
        assert_eq!(export(&file, &db, true).unwrap(), 2);
        let text = read(&file).unwrap();
        assert!(text.contains("\"'@copy\""));
        assert!(text.contains("\"'=1+1, \"\"Édition\"\"\""));
        assert!(text.contains("\"''Björk\""));
        assert!(text.contains("\"'\t=2+2\nLine, \"\"two\"\"\""));
        assert!(text.contains("\"'＋Song\""));
        assert!(export(&source.path().join(database::DATABASE_NAME), &db, true).is_err());

        let destination = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(destination.path(), None).unwrap();
        let preview = prepare(&db, &format!("\u{feff}{text}")).unwrap();
        let restored = import(&mut db, &preview, &[]).unwrap();
        assert_eq!(
            serde_json::to_value(saved).unwrap(),
            serde_json::to_value(restored).unwrap()
        );
        drop(db);
        let db = database::initialize_database(destination.path(), None).unwrap();
        let library = database::get_album_library(&db).unwrap();
        assert_eq!(
            library.owned[0].date_acquired.as_deref(),
            Some("2024-02-29")
        );
        assert_eq!(library.owned[0].artwork, None);
        assert_eq!(library.wishlist[0].id, "wish");
    }

    #[test]
    fn validates_structure_and_reports_invalid_rows_without_hiding_valid_rows() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        assert!(
            prepare(&db, "title,artist\nAlbum,Artist")
                .err()
                .unwrap()
                .contains("required")
        );
        assert!(
            prepare(&db, "title,artist,format\n\"Bad,Artist,CD")
                .err()
                .unwrap()
                .contains("unclosed")
        );
        assert!(
            prepare(&db, "title,artist,format\n\"Bad\"suffix,Artist,CD")
                .err()
                .unwrap()
                .contains("quotation")
        );
        let preview = prepare(&db, "title,artist,format,date_acquired,release_year,favorite\n\
            Valid,Artist,CD,,2020,1\nBad date,Artist,CD,2025-02-29,,0\nBad year,Artist,CD,,10000,0\n\
            Bad boolean,Artist,CD,,,maybe\nBad format,Artist,Unknown,,,0\nShort,Artist").unwrap();
        let rows = preview.preview();
        assert!(rows[0].error.is_none());
        for (row, text) in rows[1..]
            .iter()
            .zip(["date", "year", "Favorite", "format", "columns"])
        {
            assert!(row.error.as_ref().unwrap().contains(text));
        }
        let albums = import(&mut db, &preview, &[]).unwrap();
        assert_eq!(albums.len(), 1);
        assert!(!albums[0].id.is_empty());
        assert_eq!(albums[0].date_added, None);
        let invalid_utf8 = directory.path().join("invalid.csv");
        std::fs::write(&invalid_utf8, [0xff]).unwrap();
        assert!(read(&invalid_utf8).unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn duplicate_choices_never_overwrite_and_new_conflicts_roll_back_the_batch() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        let baseline = prepare(
            &db,
            "id,title,artist,format\nexisting,Album,Artist,CD\nremoved,Deleted,Artist,CD",
        )
        .unwrap();
        import(&mut db, &baseline, &[]).unwrap();
        crate::undo::delete(&mut db, "removed").unwrap();
        let incoming = "id,title,artist,format\nexisting,Other title,Artist,CD\nnew-key, ALBUM ,artist,CD\nremoved,Returned,Artist,CD\nnew,Unique,Artist,CD";
        let preview = prepare(&db, incoming).unwrap();
        assert_eq!(
            preview
                .preview()
                .iter()
                .map(|row| row.duplicate)
                .collect::<Vec<_>>(),
            [true, true, true, false]
        );
        let copies = import(&mut db, &preview, &[2, 4]).unwrap();
        assert_eq!(copies.len(), 3);
        assert_ne!(copies[0].id, "existing");
        assert_ne!(copies[1].id, "removed");
        assert_eq!(copies[2].id, "new");
        assert_eq!(
            database::get_album(&db, "existing").unwrap().unwrap().title,
            "Album"
        );
        assert!(database::get_album(&db, "new-key").unwrap().is_none());

        let stale = prepare(
            &db,
            "id,title,artist,format\nfirst,First,Artist,CD\nlater,Later,Artist,CD",
        )
        .unwrap();
        let conflict = prepare(&db, "id,title,artist,format\nconflict,Later,Artist,CD").unwrap();
        import(&mut db, &conflict, &[]).unwrap();
        assert!(
            import(&mut db, &stale, &[])
                .err()
                .unwrap()
                .contains("Preview")
        );
        assert!(database::get_album(&db, "first").unwrap().is_none());
    }

    #[test]
    fn database_failure_rolls_back_successful_rows_and_preserves_existing_data() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        db.execute_batch(
            "INSERT INTO albums (id,title,artist,format) VALUES ('original','Original','Artist','CD');
             CREATE TRIGGER reject_csv_write BEFORE INSERT ON albums
             WHEN NEW.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'write blocked'); END;",
        ).unwrap();
        let preview = prepare(
            &db,
            "id,title,artist,format\nfirst,First,Artist,CD\nblocked,Second,Artist,CD",
        )
        .unwrap();
        assert!(preview.preview().iter().all(|row| row.error.is_none()));
        let error = import(&mut db, &preview, &[]).err().unwrap();
        assert!(error.contains("Could not import record 3. No albums were imported."));
        assert!(!error.contains("write blocked"));
        drop(db);
        let db = database::initialize_database(directory.path(), None).unwrap();
        let albums = database::get_albums(&db).unwrap();
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].id, "original");
        assert_eq!(albums[0].title, "Original");
    }
}
