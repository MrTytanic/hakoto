use std::path::Path;

pub fn initialize_database(path: &Path) -> rusqlite::Result<rusqlite::Connection> {
    let connection = rusqlite::Connection::open(path)?;

    connection.execute_batch(
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
        ",
    )?;

    Ok(connection)
}

pub fn insert_album(
    connection: &rusqlite::Connection,
    id: &str,
    title: &str,
    artist: &str,
    format: &str,
    release_year: &str,
    artwork: Option<&str>,
    favorite: bool,
) -> rusqlite::Result<usize> {
    connection.execute(
        "INSERT INTO albums
         (id, title, artist, format, release_year, artwork, favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            title,
            artist,
            format,
            release_year,
            artwork,
            favorite,
        ],
    )
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub format: String,
    pub release_year: String,
    pub artwork: Option<String>,
    pub favorite: bool,
}

pub fn get_albums(connection: &rusqlite::Connection,) -> rusqlite::Result<Vec<Album>> {
    let mut statement = connection.prepare(
        "SELECT id, title, artist, format, release_year, artwork, favorite
         FROM albums
         ORDER BY rowid ASC"
    )?;

    let albums = statement.query_map([], |row| {
        Ok(Album {
            id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            format: row.get(3)?,
            release_year: row.get(4)?,
            artwork: row.get(5)?,
            favorite: row.get(6)?,
        })
    })?;

    albums.collect()
}

pub fn update_album(
    connection: &rusqlite::Connection,
    id: &str,
    title: &str,
    artist: &str,
    format: &str,
    release_year: &str,
    artwork: Option<&str>,
    favorite: bool,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE albums
            SET title = ?1,
                artist = ?2,
                format = ?3,
                release_year = ?4,
                artwork = ?5,
                favorite = ?6
            WHERE id = ?7;",
        rusqlite::params![
            title,
            artist,
            format,
            release_year,
            artwork,
            favorite,
            id,
        ],
    )
}

pub fn delete_album(
    connection: &rusqlite::Connection,
    id: &str,
) -> rusqlite::Result<usize> {
    connection.execute(
        "DELETE FROM albums WHERE id = ?1;",
        rusqlite::params![id],
    )
}