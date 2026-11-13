use std::{error::Error, fs, io, path::Path};

use rusqlite::{Connection, TransactionBehavior};

use crate::{
    artwork,
    database::{ArtworkChange, database_error, image_filename},
};

pub const IMAGE_DIRECTORY: &str = "profile-images";

pub fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            display_name TEXT NOT NULL DEFAULT '',
            picture TEXT
        );
        INSERT OR IGNORE INTO profile (id) VALUES (1);",
    )
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub display_name: String,
    pub profile_picture: Option<String>,
}

pub fn get(connection: &Connection) -> rusqlite::Result<Profile> {
    connection.query_row(
        "SELECT display_name, picture FROM profile WHERE id = 1",
        [],
        |row| {
            Ok(Profile {
                display_name: row.get(0)?,
                profile_picture: row
                    .get::<_, Option<String>>(1)?
                    .filter(|name| artwork::is_filename(name)),
            })
        },
    )
}

pub fn set_display_name(connection: &Connection, name: &str) -> Result<(), String> {
    if name.encode_utf16().take(41).count() > 40 || name.chars().any(char::is_control) {
        return Err(
            "Display name must be 40 characters or fewer and contain no control characters.".into(),
        );
    }
    if connection
        .execute("UPDATE profile SET display_name = ?1 WHERE id = 1", [name])
        .map_err(database_error)?
        != 1
    {
        return Err("Profile could not be updated.".into());
    }
    Ok(())
}

pub fn set_picture(
    connection: &mut Connection,
    app_dir: &Path,
    change: ArtworkChange,
) -> Result<Option<String>, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let picture = match change {
        ArtworkChange::Remove => None,
        ArtworkChange::Replace(bytes) => {
            if !artwork::validate(&bytes) {
                return Err(
                    "Choose a valid WebP profile image up to 500 × 500 pixels and 1 MiB.".into(),
                );
            }
            let name = image_filename(&transaction).map_err(database_error)?;
            artwork::write_in(app_dir, IMAGE_DIRECTORY, &name, &bytes).map_err(
                |_| "Could not save the profile image. Check storage permissions and free space.",
            )?;
            Some(name)
        }
    };
    let result = transaction
        .execute("UPDATE profile SET picture = ?1 WHERE id = 1", [&picture])
        .and_then(|rows| {
            if rows == 1 {
                transaction.commit()
            } else {
                Err(rusqlite::Error::QueryReturnedNoRows)
            }
        });

    // Recheck the committed reference under the writer lock after either outcome.
    if let Err(error) = clean_orphaned_images(connection, app_dir) {
        eprintln!("Could not clean up profile images: {error}");
    }
    result.map_err(database_error)?;
    Ok(picture)
}

pub fn read_image(app_dir: &Path, name: &str) -> Option<Vec<u8>> {
    artwork::read_checked_in(app_dir, IMAGE_DIRECTORY, name).ok()
}

pub fn clean_orphaned_images(
    connection: &mut Connection,
    app_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let directory = match artwork::directory_in(app_dir, IMAGE_DIRECTORY) {
        Ok(directory) => directory,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let current = get(&transaction)?.profile_picture;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if let Some(name) = entry.file_name().to_str()
            && artwork::is_filename(name)
            && current.as_deref() != Some(name)
            && crate::storage::checked_file(&entry.path()).is_ok()
            && let Err(error) = fs::remove_file(entry.path())
            && error.kind() != io::ErrorKind::NotFound
        {
            eprintln!("Could not remove profile image {name}: {error}");
        }
    }
    transaction.commit()?;
    Ok(())
}
