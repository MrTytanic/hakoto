use std::path::Path;

pub fn initialize_database(path: &Path) -> rusqlite::Result<rusqlite::Connection> {
    let connection = rusqlite::Connection::open(path)?;

    connection.execute_batch(r"
    CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0
    );
")?;
    Ok(connection)
}