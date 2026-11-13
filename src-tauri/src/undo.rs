use crate::{
    artwork, crates,
    database::{self, database_error},
    metadata, shelves,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
struct DeletedAlbum {
    #[serde(deserialize_with = "read_archived_album")]
    album: database::Album,
    // Album command deserialization ignores these backend-owned fields.
    artwork: Option<String>,
    date_added: Option<String>,
    placements: Vec<shelves::Placement>,
    #[serde(default)]
    crate_memberships: Vec<crates::ArchivedMembership>,
}

fn read_archived_album<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<database::Album, D::Error> {
    let mut album = serde_json::Value::deserialize(deserializer)?;
    if let Some(value) = album.get_mut("releaseYear")
        && let Some(year) = value.as_str()
    {
        let year = year.trim_matches(' ');
        let number = year.parse::<u16>().ok().filter(|number| {
            year.len() <= 4
                && year.bytes().all(|byte| byte.is_ascii_digit())
                && (1..=9999).contains(number)
        });
        *value = number.into();
    }
    serde_json::from_value(album).map_err(serde::de::Error::custom)
}

#[derive(Serialize)]
pub struct PendingDeletion {
    token: String,
    title: String,
}

pub fn pending(connection: &Connection) -> Result<Vec<PendingDeletion>, String> {
    let mut statement = connection
        .prepare("SELECT token, payload FROM undo_albums ORDER BY rowid")
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(database_error)?;
    rows.map(|row| {
        let (token, payload) = row.map_err(database_error)?;
        let snapshot: DeletedAlbum = serde_json::from_str(&payload)
            .map_err(|_| "The saved album recovery data could not be read.")?;
        Ok(PendingDeletion {
            token,
            title: snapshot.album.title,
        })
    })
    .collect()
}

pub fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS undo_albums (
        token TEXT PRIMARY KEY, payload TEXT NOT NULL, artwork TEXT, expires INTEGER NOT NULL
    );",
    )
}

pub fn delete(connection: &mut Connection, id: &str) -> Result<String, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    metadata::album_reference(&transaction, id)?;
    let album = database::get_album(&transaction, id)
        .map_err(database_error)?
        .ok_or("Album no longer exists.")?;
    let placements = {
        let mut statement = transaction.prepare(
            "SELECT shelf_id, row_index, column_index FROM shelf_placements WHERE album_id = ?1"
        ).map_err(database_error)?;
        statement
            .query_map([id], |row| {
                Ok(shelves::Placement {
                    shelf_id: row.get(0)?,
                    row: row.get(1)?,
                    column: row.get(2)?,
                    album_id: id.into(),
                })
            })
            .map_err(database_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(database_error)?
    };
    let snapshot = DeletedAlbum {
        artwork: album.artwork.clone(),
        date_added: album.date_added.clone(),
        album,
        placements,
        crate_memberships: crates::memberships(&transaction, id).map_err(database_error)?,
    };
    let payload = serde_json::to_string(&snapshot)
        .map_err(|_| "The album recovery copy could not be prepared.")?;
    let token: String = transaction
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(database_error)?;
    let archived = transaction
        .execute(
            "INSERT INTO undo_albums VALUES (?1, ?2, ?3, unixepoch() + 86400)",
            params![token, payload, snapshot.artwork],
        )
        .map_err(database_error)?;
    if archived != 1 {
        return Err("The recovery copy could not be saved. Album deletion was canceled.".into());
    }
    if transaction
        .execute("DELETE FROM albums WHERE id = ?1", [id])
        .map_err(database_error)?
        != 1
    {
        return Err("Album deletion was not completed. Nothing was changed.".into());
    }
    transaction.commit().map_err(database_error)?;
    Ok(token)
}

pub fn restore(
    connection: &mut Connection,
    directory: &Path,
    token: &str,
) -> Result<database::Album, String> {
    metadata::required_text(token, 128, "Album recovery token")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let payload: String = transaction
        .query_row(
            "SELECT payload FROM undo_albums WHERE token = ?1",
            [token],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or("This album recovery copy is no longer available.")?;
    let mut snapshot: DeletedAlbum = serde_json::from_str(&payload)
        .map_err(|_| "The saved album recovery data could not be read.")?;
    if let Some(name) = &snapshot.artwork {
        artwork::read_checked(directory, name).map_err(
            |_| "The album artwork is missing or invalid. The recovery copy is retained.",
        )?;
    }
    snapshot.album.artwork = snapshot.artwork;
    snapshot.album.date_added = snapshot.date_added;
    if database::write_album(&transaction, database::INSERT_ALBUM, &snapshot.album)
        .map_err(database_error)?
        != 1
    {
        return Err("Album restoration was not completed. The recovery copy is retained.".into());
    }
    for placement in snapshot.placements {
        // A deleted shelf no longer has a placement to restore, just like a deleted crate.
        let shelf_exists: bool = transaction
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM shelves WHERE id = ?1)",
                [placement.shelf_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !shelf_exists {
            continue;
        }
        // An occupied or out-of-bounds slot on a surviving shelf aborts the restore.
        let restored = transaction
            .execute(
                "INSERT INTO shelf_placements VALUES (?1, ?2, ?3, ?4)",
                params![
                    placement.shelf_id,
                    placement.row,
                    placement.column,
                    placement.album_id
                ],
            )
            .map_err(|_| "A previous shelf position is unavailable. Nothing was restored.")?;
        if restored != 1 {
            return Err(
                "A previous shelf position could not be restored. Nothing was changed.".into(),
            );
        }
    }
    for membership in snapshot.crate_memberships {
        crates::restore_membership(&transaction, &snapshot.album.id, membership)?;
    }
    let cleared = transaction
        .execute("DELETE FROM undo_albums WHERE token = ?1", [token])
        .map_err(database_error)?;
    if cleared != 1 {
        return Err("The recovery copy could not be finalized. Nothing was restored.".into());
    }
    transaction.commit().map_err(database_error)?;
    Ok(snapshot.album)
}

pub fn discard(connection: &mut Connection, directory: &Path, token: &str) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let name: Option<Option<String>> = transaction
        .query_row(
            "SELECT artwork FROM undo_albums WHERE token = ?1",
            [token],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?;
    let cleared = transaction
        .execute("DELETE FROM undo_albums WHERE token = ?1", [token])
        .map_err(database_error)?;
    if name.is_some() && cleared != 1 {
        return Err("The recovery copy could not be removed.".into());
    }
    transaction.commit().map_err(database_error)?;
    database::cleanup(connection, directory, name.flatten().as_deref());
    Ok(())
}

pub fn purge_expired(connection: &mut Connection, directory: &Path) -> Result<(), String> {
    let tokens = {
        let mut statement = connection
            .prepare("SELECT token FROM undo_albums WHERE expires < unixepoch()")
            .map_err(database_error)?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(database_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(database_error)?
    };
    for token in tokens {
        discard(connection, directory, &token)?;
    }
    Ok(())
}
