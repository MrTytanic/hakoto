use crate::{artwork, database, shelves};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
struct DeletedAlbum {
    album: database::Album,
    // Album command deserialization ignores these backend-owned fields.
    artwork: Option<String>,
    date_added: Option<String>,
    placements: Vec<shelves::Placement>,
}

#[derive(Serialize)]
pub struct PendingDeletion {
    token: String,
    title: String,
}

pub fn pending(connection: &Connection) -> Result<Vec<PendingDeletion>, String> {
    let mut statement = connection
        .prepare("SELECT token, payload FROM undo_albums ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (token, payload) = row.map_err(|e| e.to_string())?;
        let snapshot: DeletedAlbum = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
    let album = database::get_album(&transaction, id)
        .map_err(|error| error.to_string())?
        .ok_or("Album no longer exists.")?;
    let placements = {
        let mut statement = transaction.prepare(
            "SELECT shelf_id, row_index, column_index FROM shelf_placements WHERE album_id = ?1"
        ).map_err(|e| e.to_string())?;
        statement
            .query_map([id], |row| {
                Ok(shelves::Placement {
                    shelf_id: row.get(0)?,
                    row: row.get(1)?,
                    column: row.get(2)?,
                    album_id: id.into(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    let snapshot = DeletedAlbum {
        artwork: album.artwork.clone(),
        date_added: album.date_added.clone(),
        album,
        placements,
    };
    let payload = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let token: String = transaction
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let archived = transaction
        .execute(
            "INSERT INTO undo_albums VALUES (?1, ?2, ?3, unixepoch() + 86400)",
            params![token, payload, snapshot.artwork],
        )
        .map_err(|e| e.to_string())?;
    if archived != 1 {
        return Err("The recovery copy could not be saved. Album deletion was canceled.".into());
    }
    if transaction
        .execute("DELETE FROM albums WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?
        != 1
    {
        return Err("Album deletion was not completed. Nothing was changed.".into());
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(token)
}

pub fn restore(
    connection: &mut Connection,
    directory: &Path,
    token: &str,
) -> Result<database::Album, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let payload: String = transaction
        .query_row(
            "SELECT payload FROM undo_albums WHERE token = ?1",
            [token],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut snapshot: DeletedAlbum = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    if let Some(name) = &snapshot.artwork {
        artwork::read_checked(directory, name)
            .map_err(|e| format!("Cannot restore album artwork: {e}"))?;
    }
    snapshot.album.artwork = snapshot.artwork;
    snapshot.album.date_added = snapshot.date_added;
    if database::write_album(&transaction, database::INSERT_ALBUM, &snapshot.album)
        .map_err(|error| error.to_string())?
        != 1
    {
        return Err("Album restoration was not completed. The recovery copy is retained.".into());
    }
    for placement in snapshot.placements {
        // Plain INSERT rejects occupied slots. Foreign keys and bounds triggers reject changed shelves.
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
            .map_err(|e| {
                format!("A previous shelf position is unavailable. Nothing was restored: {e}")
            })?;
        if restored != 1 {
            return Err(
                "A previous shelf position could not be restored. Nothing was changed.".into(),
            );
        }
    }
    let cleared = transaction
        .execute("DELETE FROM undo_albums WHERE token = ?1", [token])
        .map_err(|e| e.to_string())?;
    if cleared != 1 {
        return Err("The recovery copy could not be finalized. Nothing was restored.".into());
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(snapshot.album)
}

pub fn discard(connection: &mut Connection, directory: &Path, token: &str) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let name: Option<Option<String>> = transaction
        .query_row(
            "SELECT artwork FROM undo_albums WHERE token = ?1",
            [token],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let cleared = transaction
        .execute("DELETE FROM undo_albums WHERE token = ?1", [token])
        .map_err(|e| e.to_string())?;
    if name.is_some() && cleared != 1 {
        return Err("The recovery copy could not be removed.".into());
    }
    transaction.commit().map_err(|e| e.to_string())?;
    database::cleanup(connection, directory, name.flatten().as_deref());
    Ok(())
}

pub fn purge_expired(connection: &mut Connection, directory: &Path) -> Result<(), String> {
    let tokens = {
        let mut statement = connection
            .prepare("SELECT token FROM undo_albums WHERE expires < unixepoch()")
            .map_err(|e| e.to_string())?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    for token in tokens {
        discard(connection, directory, &token)?;
    }
    Ok(())
}
