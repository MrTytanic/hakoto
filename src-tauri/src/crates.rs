use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

pub fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS crates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            description TEXT
        ) STRICT;
        CREATE TABLE IF NOT EXISTS crate_albums (
            crate_id INTEGER NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
            album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 0),
            PRIMARY KEY (crate_id, album_id),
            UNIQUE (crate_id, position)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS crate_albums_by_album ON crate_albums (album_id);
        CREATE TRIGGER IF NOT EXISTS crate_album_insert_owned
        BEFORE INSERT ON crate_albums
        WHEN EXISTS (SELECT 1 FROM albums WHERE id = NEW.album_id AND ownership = 'wishlist')
        BEGIN SELECT RAISE(ABORT, 'Add this album to your collection first'); END;
        CREATE TRIGGER IF NOT EXISTS crate_album_update_owned
        BEFORE UPDATE OF album_id ON crate_albums
        WHEN EXISTS (SELECT 1 FROM albums WHERE id = NEW.album_id AND ownership = 'wishlist')
        BEGIN SELECT RAISE(ABORT, 'Add this album to your collection first'); END;",
    )
}

#[derive(Deserialize)]
pub struct CrateSettings {
    name: String,
    description: Option<String>,
    #[serde(default, rename = "albumIds")]
    album_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crate {
    id: i64,
    name: String,
    description: Option<String>,
    album_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoveDirection {
    Up,
    Down,
}

fn read_crates(connection: &Connection, id: Option<i64>) -> rusqlite::Result<Vec<Crate>> {
    let mut statement = connection.prepare(
        "SELECT crates.id, name, description, album_id FROM crates
         LEFT JOIN crate_albums ON crate_id = crates.id
         WHERE ?1 IS NULL OR crates.id = ?1 ORDER BY crates.id, position",
    )?;
    let mut rows = statement.query([id])?;
    let mut crates: Vec<Crate> = Vec::new();
    while let Some(row) = rows.next()? {
        let id = row.get(0)?;
        if crates.last().is_none_or(|item| item.id != id) {
            crates.push(Crate {
                id,
                name: row.get(1)?,
                description: row.get(2)?,
                album_ids: Vec::new(),
            });
        }
        if let Some(album_id) = row.get::<_, Option<String>>(3)? {
            crates.last_mut().unwrap().album_ids.push(album_id);
        }
    }
    Ok(crates)
}

fn read_crate(connection: &Connection, id: i64) -> Result<Crate> {
    read_crates(connection, Some(id))
        .map_err(|error| error.to_string())?
        .pop()
        .ok_or_else(|| "This crate no longer exists.".into())
}

pub fn list(connection: &Connection) -> Result<Vec<Crate>> {
    read_crates(connection, None).map_err(|error| error.to_string())
}

fn require_write(rows: rusqlite::Result<usize>, message: &str) -> Result<()> {
    match rows.map_err(|error| error.to_string())? {
        1 => Ok(()),
        _ => Err(message.into()),
    }
}

pub fn save(
    connection: &mut Connection,
    id: Option<i64>,
    settings: CrateSettings,
) -> Result<Crate> {
    let name = settings.name.trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("Enter a crate name without control characters.".into());
    }
    if id.is_some() && !settings.album_ids.is_empty() {
        return Err("Use the crate membership controls to edit its albums.".into());
    }
    let description = settings
        .description
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let id = if let Some(id) = id {
        require_write(
            transaction.execute(
                "UPDATE crates SET name = ?2, description = ?3 WHERE id = ?1",
                params![id, name, description],
            ),
            "Could not update this crate.",
        )?;
        id
    } else {
        require_write(
            transaction.execute(
                "INSERT INTO crates (name, description) VALUES (?1, ?2)",
                params![name, description],
            ),
            "Could not create this crate.",
        )?;
        let id = transaction.last_insert_rowid();
        for (position, album_id) in (0i64..).zip(&settings.album_ids) {
            insert_album(&transaction, id, album_id, position)?;
        }
        id
    };
    let updated = read_crate(&transaction, id)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(updated)
}

pub fn delete(connection: &Connection, id: i64) -> Result<()> {
    require_write(
        connection.execute("DELETE FROM crates WHERE id = ?1", [id]),
        "Could not delete this crate.",
    )
}

fn edit_membership(
    connection: &mut Connection,
    id: i64,
    edit: impl FnOnce(&Connection) -> Result<()>,
) -> Result<Crate> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    edit(&transaction)?;
    let updated = read_crate(&transaction, id)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(updated)
}

fn next_position(connection: &Connection, id: i64) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT coalesce(max(position), -1) + 1 FROM crate_albums WHERE crate_id = ?1",
        [id],
        |row| row.get(0),
    )
}

fn insert_album(connection: &Connection, id: i64, album_id: &str, position: i64) -> Result<()> {
    require_write(
        connection.execute(
            "INSERT INTO crate_albums (crate_id, album_id, position)
             SELECT ?1, albums.id, ?3 FROM albums WHERE albums.id = ?2 AND ownership = 'owned'
             ON CONFLICT (crate_id, album_id) DO NOTHING",
            params![id, album_id, position],
        ),
        "Only owned albums can be added, once per crate.",
    )
}

pub fn add_album(connection: &mut Connection, id: i64, album_id: &str) -> Result<Crate> {
    edit_membership(connection, id, |transaction| {
        let position = next_position(transaction, id).map_err(|error| error.to_string())?;
        insert_album(transaction, id, album_id, position)
    })
}

pub fn remove_album(connection: &mut Connection, id: i64, album_id: &str) -> Result<Crate> {
    edit_membership(connection, id, |transaction| {
        require_write(
            transaction.execute(
                "DELETE FROM crate_albums WHERE crate_id = ?1 AND album_id = ?2",
                params![id, album_id],
            ),
            "This album is no longer in the crate.",
        )
    })
}

pub fn move_album(
    connection: &mut Connection,
    id: i64,
    album_id: &str,
    direction: MoveDirection,
) -> Result<Crate> {
    edit_membership(connection, id, |transaction| {
        let position: i64 = transaction
            .query_row(
                "SELECT position FROM crate_albums WHERE crate_id = ?1 AND album_id = ?2",
                params![id, album_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or("This album is no longer in the crate.")?;
        let neighbor_query = match direction {
            MoveDirection::Up => {
                "SELECT position FROM crate_albums WHERE crate_id = ?1 AND position < ?2 ORDER BY position DESC LIMIT 1"
            }
            MoveDirection::Down => {
                "SELECT position FROM crate_albums WHERE crate_id = ?1 AND position > ?2 ORDER BY position LIMIT 1"
            }
        };
        let neighbor: Option<i64> = transaction
            .query_row(neighbor_query, params![id, position], |row| row.get(0))
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(neighbor) = neighbor {
            let temporary = next_position(transaction, id).map_err(|error| error.to_string())?;
            for (from, to) in [
                (position, temporary),
                (neighbor, position),
                (temporary, neighbor),
            ] {
                require_write(transaction.execute(
                    "UPDATE crate_albums SET position = ?3 WHERE crate_id = ?1 AND position = ?2",
                    params![id, from, to],
                ), "Could not reorder this crate.")?;
            }
        }
        Ok(())
    })
}

#[derive(Deserialize, Serialize)]
pub struct ArchivedMembership {
    crate_id: i64,
    position: i64,
}

pub fn memberships(
    connection: &Connection,
    album_id: &str,
) -> rusqlite::Result<Vec<ArchivedMembership>> {
    let mut statement =
        connection.prepare("SELECT crate_id, position FROM crate_albums WHERE album_id = ?1")?;
    statement
        .query_map([album_id], |row| {
            Ok(ArchivedMembership {
                crate_id: row.get(0)?,
                position: row.get(1)?,
            })
        })?
        .collect()
}

pub fn restore_membership(
    connection: &Connection,
    album_id: &str,
    membership: ArchivedMembership,
) -> Result<()> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM crates WHERE id = ?1)",
            [membership.crate_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Ok(());
    }
    let occupied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM crate_albums WHERE crate_id = ?1 AND position = ?2)",
            params![membership.crate_id, membership.position],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let position = if occupied {
        next_position(connection, membership.crate_id).map_err(|error| error.to_string())?
    } else {
        membership.position
    };
    require_write(
        connection.execute(
            "INSERT INTO crate_albums (crate_id, album_id, position) VALUES (?1, ?2, ?3)",
            params![membership.crate_id, album_id, position],
        ),
        "Could not restore the album to its crate.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{database, undo};

    fn settings(name: &str, description: Option<&str>) -> CrateSettings {
        CrateSettings {
            name: name.into(),
            description: description.map(str::to_owned),
            album_ids: Vec::new(),
        }
    }

    fn add_fixture_albums(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO albums (id, title, artist, format, ownership) VALUES
             ('first', 'Same album', 'Artist', 'CD', 'owned'),
             ('second', 'Same album', 'Artist', 'CD', 'owned'),
             ('third', 'Third album', 'Artist', 'Vinyl', 'owned'),
             ('wish', 'Wish', 'Artist', '', 'wishlist');",
            )
            .unwrap();
    }

    #[test]
    fn create_saves_selected_owned_albums_in_order_or_rolls_back() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        add_fixture_albums(&db);

        for invalid in ["first", "wish", "missing"] {
            let mut draft = settings("Invalid crate", None);
            draft.album_ids = vec!["first".into(), invalid.into()];
            assert!(save(&mut db, None, draft).is_err());
            assert!(list(&db).unwrap().is_empty());
        }

        let mut draft = settings("Selected albums", None);
        draft.album_ids = vec!["second".into(), "first".into()];
        let created = save(&mut db, None, draft).unwrap();
        assert_eq!(created.album_ids, ["second", "first"]);
        assert_eq!(list(&db).unwrap()[0].album_ids, ["second", "first"]);
    }

    #[test]
    fn crate_metadata_and_order_survive_reopen_without_deleting_owned_copies() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        add_fixture_albums(&db);
        assert!(list(&db).unwrap().is_empty());
        assert!(save(&mut db, None, settings("  ", None)).is_err());
        let id = save(&mut db, None, settings("First name", None))
            .unwrap()
            .id;
        let another = save(&mut db, None, settings("Other crate", None))
            .unwrap()
            .id;
        assert_ne!(id, another);
        assert_eq!(
            add_album(&mut db, id, "first").unwrap().album_ids,
            ["first"]
        );
        assert_eq!(
            add_album(&mut db, id, "second").unwrap().album_ids,
            ["first", "second"]
        );
        assert!(add_album(&mut db, id, "first").is_err());
        assert!(add_album(&mut db, id, "wish").is_err());
        add_album(&mut db, another, "first").unwrap();
        assert_eq!(
            move_album(&mut db, id, "second", MoveDirection::Up)
                .unwrap()
                .album_ids,
            ["second", "first"]
        );
        assert_eq!(
            remove_album(&mut db, id, "second").unwrap().album_ids,
            ["first"]
        );
        assert_eq!(
            add_album(&mut db, id, "second").unwrap().album_ids,
            ["first", "second"]
        );
        assert_eq!(
            move_album(&mut db, id, "first", MoveDirection::Down)
                .unwrap()
                .album_ids,
            ["second", "first"]
        );
        save(
            &mut db,
            Some(id),
            settings("Renamed", Some("First line\nSecond line")),
        )
        .unwrap();
        drop(db);

        let db = database::initialize_database(directory.path(), None).unwrap();
        let crates = list(&db).unwrap();
        assert_eq!(crates[0].id, id);
        assert_eq!(crates[0].name, "Renamed");
        assert_eq!(
            crates[0].description.as_deref(),
            Some("First line\nSecond line")
        );
        assert_eq!(crates[0].album_ids, ["second", "first"]);
        assert_eq!(crates[1].album_ids, ["first"]);
        delete(&db, id).unwrap();
        assert_eq!(list(&db).unwrap()[0].id, another);
        assert_eq!(list(&db).unwrap()[0].album_ids, ["first"]);
        assert!(database::get_album(&db, "first").unwrap().is_some());
        assert!(database::get_album(&db, "second").unwrap().is_some());
    }

    #[test]
    fn reorder_rolls_back_and_album_deletion_cascades_with_safe_undo() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        let mut db = database::initialize_database(path, None).unwrap();
        add_fixture_albums(&db);
        let id = save(&mut db, None, settings("Order", None)).unwrap().id;
        let deleted_crate = save(&mut db, None, settings("Delete later", None))
            .unwrap()
            .id;
        add_album(&mut db, id, "first").unwrap();
        add_album(&mut db, id, "second").unwrap();
        add_album(&mut db, deleted_crate, "first").unwrap();
        db.execute_batch(
            "CREATE TRIGGER reject_swap BEFORE UPDATE OF position ON crate_albums
             WHEN OLD.album_id = 'second' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        )
        .unwrap();
        assert!(move_album(&mut db, id, "first", MoveDirection::Down).is_err());
        assert_eq!(read_crate(&db, id).unwrap().album_ids, ["first", "second"]);
        db.execute_batch("DROP TRIGGER reject_swap;").unwrap();

        let token = undo::delete(&mut db, "first").unwrap();
        assert_eq!(read_crate(&db, id).unwrap().album_ids, ["second"]);
        assert!(read_crate(&db, deleted_crate).unwrap().album_ids.is_empty());
        delete(&db, deleted_crate).unwrap();
        undo::restore(&mut db, path, &token).unwrap();
        assert_eq!(read_crate(&db, id).unwrap().album_ids, ["first", "second"]);
        assert_eq!(list(&db).unwrap().len(), 1);

        let token = undo::delete(&mut db, "second").unwrap();
        add_album(&mut db, id, "third").unwrap();
        undo::restore(&mut db, path, &token).unwrap();
        assert_eq!(
            read_crate(&db, id).unwrap().album_ids,
            ["first", "third", "second"]
        );
        database::delete_album(&mut db, path, "first").unwrap();
        assert_eq!(read_crate(&db, id).unwrap().album_ids, ["third", "second"]);
    }
}
