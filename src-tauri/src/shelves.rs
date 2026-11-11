use std::collections::HashSet;

use rusqlite::{
    Connection, OptionalExtension, Row, TransactionBehavior, params,
    types::{FromSql, FromSqlError, FromSqlResult, ValueRef},
};
use serde::{Deserialize, Serialize};

const MAX_DIMENSION: i64 = 10;
const MAX_STORED_DIMENSION: i64 = 50;
const MAX_NAME_LENGTH: usize = 80;
type Result<T> = std::result::Result<T, String>;

pub fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    // Foreign-key enforcement is local to each SQLite connection.
    connection.pragma_update(None, "foreign_keys", true)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS shelves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND {MAX_NAME_LENGTH}),
            rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND {MAX_STORED_DIMENSION}),
            columns INTEGER NOT NULL CHECK (columns BETWEEN 1 AND {MAX_STORED_DIMENSION}),
            orientation TEXT NOT NULL CHECK (orientation IN ('vertical', 'horizontal'))
        ) STRICT;

        CREATE TABLE IF NOT EXISTS shelf_placements (
            shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
            row_index INTEGER NOT NULL CHECK (row_index >= 0),
            column_index INTEGER NOT NULL CHECK (column_index >= 0),
            album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
            PRIMARY KEY (shelf_id, row_index, column_index)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS shelf_placements_album ON shelf_placements (album_id);

        CREATE TRIGGER IF NOT EXISTS shelf_placement_insert_owned
        BEFORE INSERT ON shelf_placements
        WHEN EXISTS (SELECT 1 FROM albums WHERE id = NEW.album_id AND ownership = 'wishlist')
        BEGIN SELECT RAISE(ABORT, 'Add wishlist albums to your collection before placing them'); END;

        CREATE TRIGGER IF NOT EXISTS shelf_placement_update_owned
        BEFORE UPDATE OF album_id ON shelf_placements
        WHEN EXISTS (SELECT 1 FROM albums WHERE id = NEW.album_id AND ownership = 'wishlist')
        BEGIN SELECT RAISE(ABORT, 'Add wishlist albums to your collection before placing them'); END;

        CREATE TRIGGER IF NOT EXISTS shelf_placement_insert_bounds
        BEFORE INSERT ON shelf_placements
        WHEN EXISTS (SELECT 1 FROM shelves WHERE id = NEW.shelf_id
                     AND (NEW.row_index >= rows OR NEW.column_index >= columns))
        BEGIN SELECT RAISE(ABORT, 'Shelf slot is outside the shelf dimensions'); END;

        CREATE TRIGGER IF NOT EXISTS shelf_placement_update_bounds
        BEFORE UPDATE OF shelf_id, row_index, column_index ON shelf_placements
        WHEN EXISTS (SELECT 1 FROM shelves WHERE id = NEW.shelf_id
                     AND (NEW.row_index >= rows OR NEW.column_index >= columns))
        BEGIN SELECT RAISE(ABORT, 'Shelf slot is outside the shelf dimensions'); END;

        CREATE TRIGGER IF NOT EXISTS shelf_resize_bounds
        BEFORE UPDATE OF rows, columns ON shelves
        WHEN EXISTS (SELECT 1 FROM shelf_placements WHERE shelf_id = OLD.id
                     AND (row_index >= NEW.rows OR column_index >= NEW.columns))
        BEGIN SELECT RAISE(ABORT, 'Shelf resize would discard occupied slots'); END;"
    ))?;
    transaction.commit()
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Vertical,
    Horizontal,
}

impl Orientation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
        }
    }
}

impl FromSql for Orientation {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "vertical" => Ok(Self::Vertical),
            "horizontal" => Ok(Self::Horizontal),
            _ => Err(FromSqlError::Other("Invalid shelf orientation".into())),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ShelfSettings {
    pub name: String,
    pub rows: i64,
    pub columns: i64,
    pub orientation: Orientation,
}

impl ShelfSettings {
    fn validated(mut self, current: Option<&Self>) -> Result<Self> {
        self.name = self.name.trim().to_owned();
        if self.name.is_empty()
            || self.name.chars().any(char::is_control)
            || self.name.chars().count() > MAX_NAME_LENGTH
        {
            return Err(format!(
                "Enter a shelf name between 1 and {MAX_NAME_LENGTH} characters."
            ));
        }
        for (axis, value, previous) in [
            ("rows", self.rows, current.map(|shelf| shelf.rows)),
            ("columns", self.columns, current.map(|shelf| shelf.columns)),
        ] {
            let max = MAX_DIMENSION.max(previous.unwrap_or(MAX_DIMENSION));
            if !(1..=max).contains(&value) {
                return Err(format!("Shelf {axis} must be between 1 and {max}."));
            }
        }
        Ok(self)
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Shelf {
    pub id: i64,
    pub occupied: i64,
    #[serde(flatten)]
    pub settings: ShelfSettings,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub shelf_id: i64,
    pub row: i64,
    pub column: i64,
    pub album_id: String,
}

#[derive(Serialize)]
pub struct ShelfLayout {
    pub shelf: Shelf,
    pub placements: Vec<Placement>,
}

/// Coordinates are zero-based. Set assigns the slot's album, replacing any prior assignment.
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlacementChange {
    Set {
        row: i64,
        column: i64,
        album_id: String,
    },
    Clear {
        row: i64,
        column: i64,
    },
}

const SELECT_SHELVES: &str = "SELECT id, name, rows, columns, orientation,
    (SELECT count(*) FROM shelf_placements WHERE shelf_id = shelves.id) FROM shelves";

fn read_shelf(row: &Row<'_>) -> rusqlite::Result<Shelf> {
    let rows: i64 = row.get(2)?;
    let columns: i64 = row.get(3)?;
    if !(1..=MAX_STORED_DIMENSION).contains(&rows) {
        return Err(rusqlite::Error::IntegralValueOutOfRange(2, rows));
    }
    if !(1..=MAX_STORED_DIMENSION).contains(&columns) {
        return Err(rusqlite::Error::IntegralValueOutOfRange(3, columns));
    }
    Ok(Shelf {
        id: row.get(0)?,
        occupied: row.get(5)?,
        settings: ShelfSettings {
            name: row.get(1)?,
            rows,
            columns,
            orientation: row.get(4)?,
        },
    })
}

pub fn get_shelves(connection: &Connection) -> Result<Vec<Shelf>> {
    let mut statement = connection
        .prepare(&format!("{SELECT_SHELVES} ORDER BY id"))
        .map_err(|error| error.to_string())?;
    statement
        .query_map([], read_shelf)
        .and_then(Iterator::collect)
        .map_err(|error| error.to_string())
}

fn get_shelf(connection: &Connection, id: i64) -> Result<Shelf> {
    connection
        .query_row(&format!("{SELECT_SHELVES} WHERE id = ?1"), [id], read_shelf)
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Shelf {id} does not exist."))
}

fn placements(connection: &Connection, id: i64) -> rusqlite::Result<Vec<Placement>> {
    let mut statement = connection.prepare(
        "SELECT row_index, column_index, album_id FROM shelf_placements
         WHERE shelf_id = ?1 ORDER BY row_index, column_index",
    )?;
    statement
        .query_map([id], |row| {
            Ok(Placement {
                shelf_id: id,
                row: row.get(0)?,
                column: row.get(1)?,
                album_id: row.get(2)?,
            })
        })?
        .collect()
}

pub fn load_shelf(connection: &mut Connection, id: i64) -> Result<ShelfLayout> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let shelf = get_shelf(&transaction, id)?;
    let placements = placements(&transaction, id).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(ShelfLayout { shelf, placements })
}

pub fn create_shelf(connection: &Connection, settings: ShelfSettings) -> Result<Shelf> {
    let settings = settings.validated(None)?;
    let inserted = connection
        .execute(
            "INSERT INTO shelves (name, rows, columns, orientation) VALUES (?1, ?2, ?3, ?4)",
            params![
                settings.name,
                settings.rows,
                settings.columns,
                settings.orientation.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;
    if inserted != 1 {
        return Err("Shelf creation was not completed.".into());
    }
    Ok(Shelf {
        id: connection.last_insert_rowid(),
        occupied: 0,
        settings,
    })
}

pub fn update_shelf(
    connection: &mut Connection,
    id: i64,
    settings: ShelfSettings,
) -> Result<Shelf> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let current = get_shelf(&transaction, id)?;
    let settings = settings.validated(Some(&current.settings))?;
    let outside = transaction
        .query_row(
            "SELECT row_index, column_index FROM shelf_placements
         WHERE shelf_id = ?1 AND (row_index >= ?2 OR column_index >= ?3)
         ORDER BY row_index, column_index LIMIT 1",
            params![id, settings.rows, settings.columns],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((row, column)) = outside {
        return Err(format!(
            "Move or clear the album in row {}, column {} before shrinking this shelf.",
            row + 1,
            column + 1
        ));
    }
    let updated = transaction
        .execute(
            "UPDATE shelves SET name = ?2, rows = ?3, columns = ?4, orientation = ?5 WHERE id = ?1",
            params![
                id,
                settings.name,
                settings.rows,
                settings.columns,
                settings.orientation.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("Shelf {id} does not exist."));
    }
    let shelf = get_shelf(&transaction, id)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(shelf)
}

pub fn delete_shelf(connection: &Connection, id: i64) -> Result<usize> {
    connection
        .execute("DELETE FROM shelves WHERE id = ?1", [id])
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub fn update_placements(
    connection: &mut Connection,
    id: i64,
    changes: Vec<PlacementChange>,
) -> Result<Vec<Placement>> {
    update_placements_checked(connection, id, changes, None)
}

pub fn update_placements_checked(
    connection: &mut Connection,
    id: i64,
    changes: Vec<PlacementChange>,
    expected: Option<Vec<Placement>>,
) -> Result<Vec<Placement>> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let shelf = get_shelf(&transaction, id)?;
    if let Some(expected) = expected
        && placements(&transaction, id).map_err(|e| e.to_string())? != expected
    {
        return Err("The shelf has changed. Undo would overwrite a newer arrangement.".into());
    }
    let mut slots = HashSet::new();
    {
        let mut set = transaction.prepare(
            "INSERT INTO shelf_placements (shelf_id, row_index, column_index, album_id) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (shelf_id, row_index, column_index) DO UPDATE SET album_id = excluded.album_id",
        ).map_err(|error| error.to_string())?;
        let mut clear = transaction.prepare(
            "DELETE FROM shelf_placements WHERE shelf_id = ?1 AND row_index = ?2 AND column_index = ?3",
        ).map_err(|error| error.to_string())?;

        for change in changes {
            let (row, column, album) = match change {
                PlacementChange::Set {
                    row,
                    column,
                    album_id,
                } => (row, column, Some(album_id)),
                PlacementChange::Clear { row, column } => (row, column, None),
            };
            if !(0..shelf.settings.rows).contains(&row)
                || !(0..shelf.settings.columns).contains(&column)
            {
                return Err(format!(
                    "Slot ({row}, {column}) is outside this {} × {} shelf. Coordinates start at zero.",
                    shelf.settings.rows, shelf.settings.columns
                ));
            }
            if !slots.insert((row, column)) {
                return Err(format!(
                    "Slot ({row}, {column}) appears more than once in this update."
                ));
            }
            if let Some(album) = album {
                let changed = set
                    .execute(params![id, row, column, album])
                    .map_err(|error| match error {
                        rusqlite::Error::SqliteFailure(code, _)
                            if code.extended_code
                                == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY =>
                        {
                            format!("Album {album} does not exist.")
                        }
                        _ => error.to_string(),
                    })?;
                if changed != 1 {
                    return Err(
                        "Shelf placement was not completed. The arrangement is unchanged.".into(),
                    );
                }
            } else {
                let changed = clear
                    .execute(params![id, row, column])
                    .map_err(|error| error.to_string())?;
                if changed == 0 && transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM shelf_placements WHERE shelf_id = ?1 AND row_index = ?2 AND column_index = ?3)",
                    params![id, row, column], |row| row.get::<_, bool>(0),
                ).map_err(|error| error.to_string())? {
                    return Err("Shelf removal was not completed. The arrangement is unchanged.".into());
                }
            }
        }
    }
    let placements = placements(&transaction, id).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(placements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{database, profile, storage::Storage};
    use std::{fs, path::Path};

    fn settings(name: &str, rows: i64, columns: i64) -> ShelfSettings {
        ShelfSettings {
            name: name.into(),
            rows,
            columns,
            orientation: Orientation::Vertical,
        }
    }

    fn add_album(connection: &mut Connection, directory: &Path, id: &str) {
        let album = database::Album {
            id: id.into(),
            title: id.into(),
            artist: "Test artist".into(),
            format: "CD".into(),
            release_year: Some(2000),
            artwork: None,
            favorite: true,
            pinned: false,
            date_added: None,
            condition: None,
            record_type: None,
            disc_size: None,
            original_release_year: None,
            date_acquired: None,
            notes: None,
            ownership: database::Ownership::Owned,
        };
        database::save_album(connection, directory, album, None).unwrap();
    }

    fn set(row: i64, column: i64, album: &str) -> PlacementChange {
        PlacementChange::Set {
            row,
            column,
            album_id: album.into(),
        }
    }

    fn remove_shelf_schema(connection: &Connection) {
        connection
            .execute_batch("DROP TABLE shelf_placements; DROP TABLE shelves;")
            .unwrap();
    }

    #[test]
    fn undo_rejects_changed_arrangements_and_restores_unchanged_slots_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        add_album(&mut db, directory.path(), "one");
        let shelf = create_shelf(&db, settings("Shelf", 1, 2)).unwrap();
        let after = update_placements(&mut db, shelf.id, vec![set(0, 1, "one")]).unwrap();
        let expected = placements(&db, shelf.id).unwrap();
        update_placements(&mut db, shelf.id, vec![set(0, 0, "one")]).unwrap();
        assert!(
            update_placements_checked(
                &mut db,
                shelf.id,
                vec![PlacementChange::Clear { row: 0, column: 1 }],
                Some(after)
            )
            .is_err()
        );
        assert_eq!(placements(&db, shelf.id).unwrap().len(), 2);
        update_placements(
            &mut db,
            shelf.id,
            vec![PlacementChange::Clear { row: 0, column: 0 }],
        )
        .unwrap();
        let restored = update_placements_checked(
            &mut db,
            shelf.id,
            vec![
                set(0, 0, "one"),
                PlacementChange::Clear { row: 0, column: 1 },
            ],
            Some(expected),
        )
        .unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].column, 0);
    }

    #[test]
    fn ignored_shelf_mutations_report_errors_and_roll_back_batches() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        db.execute_batch(
            "CREATE TRIGGER ignore_shelf BEFORE INSERT ON shelves BEGIN SELECT RAISE(IGNORE); END;",
        )
        .unwrap();
        assert!(create_shelf(&db, settings("Missing", 1, 2)).is_err());
        db.execute_batch("DROP TRIGGER ignore_shelf;").unwrap();
        let shelf = create_shelf(&db, settings("Shelf", 1, 2)).unwrap();
        add_album(&mut db, directory.path(), "one");
        update_placements(&mut db, shelf.id, vec![set(0, 0, "one")]).unwrap();
        db.execute_batch("CREATE TRIGGER ignore_slot BEFORE INSERT ON shelf_placements BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(
            update_placements(
                &mut db,
                shelf.id,
                vec![
                    PlacementChange::Clear { row: 0, column: 0 },
                    set(0, 1, "one")
                ]
            )
            .is_err()
        );
        assert_eq!(placements(&db, shelf.id).unwrap()[0].column, 0);
        db.execute_batch("DROP TRIGGER ignore_slot; CREATE TRIGGER ignore_clear BEFORE DELETE ON shelf_placements BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        assert!(
            update_placements(
                &mut db,
                shelf.id,
                vec![
                    set(0, 1, "one"),
                    PlacementChange::Clear { row: 0, column: 0 }
                ]
            )
            .is_err()
        );
        assert_eq!(placements(&db, shelf.id).unwrap().len(), 1);
        db.execute_batch("PRAGMA ignore_check_constraints = ON;")
            .unwrap();
        db.execute(
            "UPDATE shelves SET rows = 10000000 WHERE id = ?1",
            [shelf.id],
        )
        .unwrap();
        assert!(get_shelves(&db).is_err());
        db.execute("UPDATE shelves SET rows = 1 WHERE id = ?1", [shelf.id])
            .unwrap();
        assert_eq!(get_shelves(&db).unwrap()[0].occupied, 1);
    }

    #[test]
    fn migrates_existing_database_and_persists_named_shelves_and_placements() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        add_album(&mut db, directory.path(), "one");
        profile::set_display_name(&db, "Existing profile").unwrap();
        remove_shelf_schema(&db);
        drop(db);

        let mut db = database::initialize_database(directory.path(), None).unwrap();
        assert!(get_shelves(&db).unwrap().is_empty());
        let first = create_shelf(&db, settings("  Listening room  ", 2, 3)).unwrap();
        let second = create_shelf(&db, settings("Favorites", 1, 1)).unwrap();
        assert_eq!(first.settings.name, "Listening room");
        assert_ne!(first.id, second.id);
        update_placements(&mut db, first.id, vec![set(1, 2, "one")]).unwrap();
        update_placements(&mut db, second.id, vec![set(0, 0, "one")]).unwrap();
        let second = get_shelf(&db, second.id).unwrap();
        assert_eq!(second.occupied, 1);
        let updated = update_shelf(
            &mut db,
            first.id,
            ShelfSettings {
                orientation: Orientation::Horizontal,
                ..settings("Studio", 4, 5)
            },
        )
        .unwrap();
        assert_eq!(updated.occupied, 1);
        drop(db);

        let mut db = database::initialize_database(directory.path(), None).unwrap();
        assert_eq!(get_shelves(&db).unwrap(), [updated, second]);
        let layout = load_shelf(&mut db, first.id).unwrap();
        assert_eq!(
            layout.placements,
            [Placement {
                shelf_id: first.id,
                row: 1,
                column: 2,
                album_id: "one".into()
            }]
        );
        assert!(database::get_albums(&db).unwrap()[0].favorite);
        assert_eq!(profile::get(&db).unwrap().display_name, "Existing profile");
    }

    #[test]
    fn sqlite_and_commands_reject_invalid_slots_and_unsafe_resizing() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        for invalid in [
            settings(" ", 1, 1),
            settings(&"x".repeat(81), 1, 1),
            settings("Zero", 0, 1),
            settings("Too many rows", 11, 10),
            settings("Too many columns", 10, 11),
        ] {
            assert!(create_shelf(&db, invalid).is_err());
        }
        let shelf = create_shelf(&db, settings("Records", 2, 3)).unwrap();
        add_album(&mut db, directory.path(), "one");
        update_placements(&mut db, shelf.id, vec![set(1, 2, "one")]).unwrap();
        let error = update_shelf(&mut db, shelf.id, settings("Would shrink", 1, 2)).unwrap_err();
        assert!(error.contains("row 2, column 3"));
        let unchanged = get_shelf(&db, shelf.id).unwrap();
        assert_eq!(unchanged.settings, shelf.settings);
        assert_eq!(unchanged.occupied, 1);

        let insert = "INSERT INTO shelf_placements VALUES (?1, ?2, ?3, ?4)";
        assert!(db.execute(insert, params![shelf.id, 1, 2, "one"]).is_err());
        assert!(db.execute(insert, params![shelf.id, 2, 0, "one"]).is_err());
        assert!(db.execute(insert, params![shelf.id, 0, 3, "one"]).is_err());
        assert!(db.execute(insert, params![shelf.id, -1, 0, "one"]).is_err());
        assert!(
            db.execute(insert, params![shelf.id, 0.5, 0, "one"])
                .is_err()
        );
        assert!(
            db.execute(insert, params![shelf.id, 0, 0, "missing"])
                .is_err()
        );
        assert!(
            db.execute(insert, params![shelf.id + 1, 0, 0, "one"])
                .is_err()
        );
        assert!(
            db.execute("UPDATE shelf_placements SET column_index = 3", [])
                .is_err()
        );
        assert!(
            db.execute("UPDATE shelves SET columns = 2 WHERE id = ?1", [shelf.id])
                .is_err()
        );

        update_placements(
            &mut db,
            shelf.id,
            vec![PlacementChange::Clear { row: 1, column: 2 }],
        )
        .unwrap();
        let smaller = update_shelf(&mut db, shelf.id, settings("Records", 1, 2)).unwrap();
        assert_eq!(smaller.settings.rows, 1);
        assert!(load_shelf(&mut db, shelf.id).unwrap().placements.is_empty());
    }

    #[test]
    fn legacy_shelves_can_shrink_without_losing_placements_or_expanding_past_the_limit() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        db.execute(
            "INSERT INTO shelves (name, rows, columns, orientation) VALUES ('Legacy', 14, 12, 'vertical')",
            [],
        )
        .unwrap();
        let id = db.last_insert_rowid();
        add_album(&mut db, directory.path(), "one");
        update_placements(&mut db, id, vec![set(11, 8, "one")]).unwrap();

        assert!(update_shelf(&mut db, id, settings("Renamed", 14, 12)).is_ok());
        let error = update_shelf(&mut db, id, settings("Renamed", 15, 12)).unwrap_err();
        assert!(error.contains("rows must be between 1 and 14"));
        let error = update_shelf(&mut db, id, settings("Renamed", 10, 10)).unwrap_err();
        assert!(error.contains("row 12, column 9"));
        let layout = load_shelf(&mut db, id).unwrap();
        assert_eq!(layout.shelf.settings, settings("Renamed", 14, 12));

        assert!(update_shelf(&mut db, id, settings("Renamed", 12, 10)).is_ok());
        let error = update_shelf(&mut db, id, settings("Renamed", 12, 11)).unwrap_err();
        assert!(error.contains("columns must be between 1 and 10"));
        assert_eq!(
            load_shelf(&mut db, id).unwrap().placements,
            layout.placements
        );
    }

    #[test]
    fn placement_batches_support_swaps_and_roll_back_all_changes_on_error() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        let id = create_shelf(&db, settings("Shelf", 1, 2)).unwrap().id;
        add_album(&mut db, directory.path(), "one");
        add_album(&mut db, directory.path(), "two");
        let initial =
            update_placements(&mut db, id, vec![set(0, 0, "one"), set(0, 1, "two")]).unwrap();
        for (invalid, message) in [
            (set(0, 1, "missing"), "does not exist"),
            (set(1, 0, "one"), "outside"),
            (set(0, 0, "one"), "more than once"),
        ] {
            let error =
                update_placements(&mut db, id, vec![set(0, 0, "two"), invalid]).unwrap_err();
            assert!(error.contains(message), "{error}");
            assert_eq!(load_shelf(&mut db, id).unwrap().placements, initial);
        }
        let swapped =
            update_placements(&mut db, id, vec![set(0, 1, "one"), set(0, 0, "two")]).unwrap();
        assert_eq!(
            swapped
                .iter()
                .map(|slot| slot.album_id.as_str())
                .collect::<Vec<_>>(),
            ["two", "one"]
        );
        assert!(load_shelf(&mut db, id + 1).is_err());
        assert!(update_placements(&mut db, id + 1, vec![]).is_err());
    }

    #[test]
    fn album_and_shelf_deletion_cascade_without_touching_other_data() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = database::initialize_database(directory.path(), None).unwrap();
        let first = create_shelf(&db, settings("First", 1, 2)).unwrap().id;
        let second = create_shelf(&db, settings("Second", 1, 2)).unwrap().id;
        for album in ["one", "two"] {
            add_album(&mut db, directory.path(), album);
        }
        for id in [first, second] {
            update_placements(&mut db, id, vec![set(0, 0, "one"), set(0, 1, "two")]).unwrap();
        }
        assert_eq!(
            database::delete_album(&mut db, directory.path(), "one").unwrap(),
            1
        );
        assert_eq!(delete_shelf(&db, first).unwrap(), 1);
        assert_eq!(delete_shelf(&db, first).unwrap(), 0);
        assert!(placements(&db, first).unwrap().is_empty());
        let remaining = load_shelf(&mut db, second).unwrap().placements;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].album_id, "two");
        assert_eq!(database::get_albums(&db).unwrap()[0].id, "two");
    }

    #[test]
    fn relocated_databases_migrate_and_preserve_shelf_data_through_later_moves() {
        let root = tempfile::tempdir().unwrap();
        let default = root.path().join("default");
        let destination = root.path().join("destination");
        fs::create_dir(&destination).unwrap();
        let mut storage = Storage::open(&default, None).unwrap();
        add_album(&mut storage.connection, &storage.directory, "one");
        storage.relocate(&destination).unwrap();
        remove_shelf_schema(&storage.connection);
        drop(storage);

        let mut storage = Storage::open(&default, None).unwrap();
        let id = create_shelf(&storage.connection, settings("Custom location shelf", 1, 1))
            .unwrap()
            .id;
        update_placements(&mut storage.connection, id, vec![set(0, 0, "one")]).unwrap();
        storage.relocate(&default).unwrap();
        let layout = load_shelf(&mut storage.connection, id).unwrap();
        assert_eq!(layout.shelf.settings.name, "Custom location shelf");
        assert_eq!(layout.placements[0].album_id, "one");
        database::delete_album(&mut storage.connection, &storage.directory, "one").unwrap();
        assert!(
            load_shelf(&mut storage.connection, id)
                .unwrap()
                .placements
                .is_empty()
        );
    }
}
