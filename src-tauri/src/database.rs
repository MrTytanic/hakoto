pub fn initialize_database() -> rusqlite::Result<rusqlite::Connection> {
    rusqlite::Connection::open("sleevy.db")
}