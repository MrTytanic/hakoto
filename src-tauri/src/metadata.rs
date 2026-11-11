use crate::database::Album;

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

pub fn validate(album: &mut Album, previous: Option<&Album>) -> Result<(), String> {
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
        text(album.format.trim(), 100, "Format")?;
        album.format = album.format.trim().to_owned();
    }
    if previous.is_none_or(|old| old.release_year != album.release_year) {
        let year = album.release_year.trim();
        if !year.is_empty()
            && (year.len() != 4
                || !year.bytes().all(|byte| byte.is_ascii_digit())
                || year == "0000")
        {
            return Err("Release year must be four digits (0001–9999), or blank.".into());
        }
        album.release_year = year.to_owned();
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
