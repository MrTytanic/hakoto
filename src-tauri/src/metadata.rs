use crate::database::{Album, Ownership};
use rusqlite::Connection;

const FORMATS: &[&str] = &[
    "CD",
    "Vinyl",
    "Vinyl (12-inch LP)",
    "Vinyl (10-inch)",
    "Vinyl (7-inch / Single)",
    "Cassette",
    "8-Track Cartridge",
    "MiniDisc",
    "SACD",
    "DVD-Audio",
    "Reel-to-Reel",
    "Flexi Disc",
    "Shellac (78 RPM)",
    "Other",
    "Other Physical",
    "Digital (MP3)",
    "Digital (FLAC)",
    "Digital (WAV)",
    "Digital (ALAC)",
    "Digital (AAC)",
    "Digital (Other)",
];

pub fn validate_format(format: &str, ownership: Ownership) -> Result<&str, String> {
    let format = format.trim();
    if FORMATS.contains(&format) || (ownership == Ownership::Wishlist && format.is_empty()) {
        Ok(format)
    } else {
        Err("Choose a supported album format.".into())
    }
}

pub fn validate_acquisition_date(connection: &Connection, date: &str) -> Result<(), String> {
    let valid = date.len() == 10
        && !date.starts_with("0000")
        && connection
            .query_row("SELECT date(?1, '+0 days') IS ?1", [date], |row| {
                row.get::<_, bool>(0)
            })
            .map_err(|error| error.to_string())?;
    if valid {
        Ok(())
    } else {
        Err("Enter a valid acquisition date (YYYY-MM-DD).".into())
    }
}

fn text(value: &str, limit: usize, label: &str) -> Result<(), String> {
    if value.encode_utf16().take(limit + 1).count() > limit
        || value.trim().is_empty()
        || value.chars().any(char::is_control)
    {
        return Err(format!(
            "{label} must contain 1–{limit} characters and no control characters."
        ));
    }
    Ok(())
}

fn choice(
    value: &mut Option<String>,
    previous: Option<&Option<String>>,
    allowed: &[&str],
    label: &str,
) -> Result<(), String> {
    if previous.is_some_and(|old| old == value) {
        return Ok(());
    }
    let trimmed = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if trimmed.is_some_and(|value| !allowed.contains(&value)) {
        return Err(format!(
            "Choose a supported {label}, or leave it unspecified."
        ));
    }
    *value = trimmed.map(str::to_owned);
    Ok(())
}

pub fn validate(
    connection: &Connection,
    album: &mut Album,
    previous: Option<&Album>,
) -> Result<(), String> {
    // Keep unchanged legacy fields intact, including values accepted by older versions.
    if previous.is_none() {
        text(&album.id, 128, "Album ID")?;
    }
    if previous.is_none_or(|old| old.title != album.title) {
        text(album.title.trim(), 500, "Title")?;
        album.title = album.title.trim().to_owned();
    }
    if previous.is_none_or(|old| old.artist != album.artist) {
        text(album.artist.trim(), 300, "Artist")?;
        album.artist = album.artist.trim().to_owned();
    }
    if previous.is_none_or(|old| old.format != album.format) {
        album.format = validate_format(&album.format, album.ownership)?.to_owned();
    }
    for (label, year) in [
        ("Edition release year", album.release_year),
        ("Original release year", album.original_release_year),
    ] {
        if year.is_some_and(|year| !(1..=9999).contains(&year)) {
            return Err(format!(
                "{label} must be an integer from 1 to 9999, or blank."
            ));
        }
    }
    if album.date_acquired.as_deref() == Some("") {
        album.date_acquired = None;
    }
    if let Some(date) = &album.date_acquired {
        if album.ownership == Ownership::Wishlist {
            return Err("Add the album to your collection to record its acquisition date.".into());
        }
        validate_acquisition_date(connection, date)?;
    }
    if let Some(notes) = &album.notes {
        let notes = notes.replace("\r\n", "\n").replace('\r', "\n");
        if notes.encode_utf16().take(1001).count() > 1000 {
            return Err("Notes must be 1,000 characters or fewer.".into());
        }
        if notes
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
        {
            return Err(
                "Notes can contain line breaks and tabs, but no other control characters.".into(),
            );
        }
        album.notes = (!notes.is_empty()).then_some(notes);
    }
    choice(
        &mut album.condition,
        previous.map(|old| &old.condition),
        &[
            "Mint",
            "Near Mint",
            "Very Good+",
            "Very Good",
            "Good",
            "Poor",
        ],
        "condition",
    )?;
    choice(
        &mut album.record_type,
        previous.map(|old| &old.record_type),
        &["LP", "EP", "Single", "Other"],
        "record type",
    )?;
    choice(
        &mut album.disc_size,
        previous.map(|old| &old.disc_size),
        &["7", "10", "12"],
        "disc size",
    )?;
    if !album.format.starts_with("Vinyl")
        && (album.record_type.is_some() || album.disc_size.is_some())
        && previous.is_none_or(|old| {
            old.format != album.format
                || old.record_type != album.record_type
                || old.disc_size != album.disc_size
        })
    {
        return Err("Record type and disc size apply only to vinyl albums.".into());
    }
    Ok(())
}
