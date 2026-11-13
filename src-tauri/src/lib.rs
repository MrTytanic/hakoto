use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};
use tauri::{AppHandle, Manager, State, http};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod artwork;
mod backup;
mod collection_csv;
mod crates;
mod database;
mod metadata;
mod profile;
mod shelves;
mod storage;
mod undo;

struct DatabaseState {
    storage: Mutex<Result<storage::Storage, String>>,
    relocation: Mutex<()>,
    csv_import: Mutex<Option<PendingCsvImport>>,
    backup_restore: Mutex<Option<PendingBackupRestore>>,
}

struct PendingBackupRestore {
    active_directory: PathBuf,
    staged: backup::StagedRestore,
}

struct PendingCsvImport {
    token: u32,
    directory: PathBuf,
    prepared: collection_csv::PreparedImport,
}

#[derive(serde::Serialize)]
struct CsvPreview {
    token: u32,
    rows: Vec<collection_csv::PreviewRow>,
}

impl DatabaseState {
    fn with_storage<T>(
        &self,
        action: impl FnOnce(&mut storage::Storage) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .storage
            .lock()
            .map_err(|_| "Hakoto storage is unavailable. Restart Hakoto and try again.")?;
        action(state.as_mut().map_err(|error| error.clone())?)
    }
}

#[tauri::command]
fn save_album(
    state: State<'_, DatabaseState>,
    album: database::Album,
    artwork: Option<Vec<u8>>,
) -> Result<database::Album, String> {
    state.with_storage(|storage| {
        database::save_album(&mut storage.connection, &storage.directory, album, artwork)
    })
}

#[tauri::command]
fn get_album_library(state: State<'_, DatabaseState>) -> Result<database::AlbumLibrary, String> {
    state.with_storage(|storage| {
        database::get_album_library(&mut storage.connection).map_err(database::database_error)
    })
}

#[tauri::command]
fn update_album(
    state: State<'_, DatabaseState>,
    album: database::Album,
    artwork: Option<database::ArtworkChange>,
) -> Result<database::Album, String> {
    state.with_storage(|storage| {
        database::update_album(&mut storage.connection, &storage.directory, album, artwork)
    })
}

#[tauri::command]
fn acquire_album(
    state: State<'_, DatabaseState>,
    id: String,
    format: String,
    date_acquired: String,
) -> Result<database::Album, String> {
    state.with_storage(|storage| {
        database::acquire_album(&mut storage.connection, &id, &format, &date_acquired)
    })
}

#[tauri::command]
fn get_deleted_albums(
    state: State<'_, DatabaseState>,
) -> Result<Vec<undo::PendingDeletion>, String> {
    state.with_storage(|storage| undo::pending(&storage.connection))
}

#[tauri::command]
fn delete_album_recoverable(state: State<'_, DatabaseState>, id: String) -> Result<String, String> {
    state.with_storage(|storage| undo::delete(&mut storage.connection, &id))
}

#[tauri::command]
fn restore_deleted_album(
    state: State<'_, DatabaseState>,
    token: String,
) -> Result<database::Album, String> {
    state.with_storage(|storage| undo::restore(&mut storage.connection, &storage.directory, &token))
}

#[tauri::command]
fn discard_deleted_album(state: State<'_, DatabaseState>, token: String) -> Result<(), String> {
    metadata::required_text(&token, 128, "Album recovery token")?;
    state.with_storage(|storage| undo::discard(&mut storage.connection, &storage.directory, &token))
}

#[tauri::command]
fn delete_album(state: State<'_, DatabaseState>, id: String) -> Result<usize, String> {
    state.with_storage(|storage| {
        database::delete_album(&mut storage.connection, &storage.directory, &id)
    })
}

#[tauri::command]
fn read_artwork_bytes(
    state: State<'_, DatabaseState>,
    filename: String,
) -> Result<tauri::ipc::Response, String> {
    state.with_storage(|storage| {
        artwork::read(&storage.directory, &filename)
            .map(tauri::ipc::Response::new)
            .ok_or_else(|| "Album artwork is unavailable.".into())
    })
}

#[tauri::command]
fn get_shelves(state: State<'_, DatabaseState>) -> Result<Vec<shelves::Shelf>, String> {
    state.with_storage(|storage| shelves::get_shelves(&storage.connection))
}

#[tauri::command]
fn get_crates(state: State<'_, DatabaseState>) -> Result<Vec<crates::Crate>, String> {
    state.with_storage(|storage| crates::list(&storage.connection))
}

#[tauri::command]
fn save_crate(
    state: State<'_, DatabaseState>,
    crate_id: Option<i64>,
    settings: crates::CrateSettings,
) -> Result<crates::Crate, String> {
    state.with_storage(|storage| crates::save(&mut storage.connection, crate_id, settings))
}

#[tauri::command]
fn delete_crate(state: State<'_, DatabaseState>, crate_id: i64) -> Result<(), String> {
    state.with_storage(|storage| crates::delete(&storage.connection, crate_id))
}

#[tauri::command]
fn add_crate_album(
    state: State<'_, DatabaseState>,
    crate_id: i64,
    album_id: String,
) -> Result<crates::Crate, String> {
    state.with_storage(|storage| crates::add_album(&mut storage.connection, crate_id, &album_id))
}

#[tauri::command]
fn remove_crate_album(
    state: State<'_, DatabaseState>,
    crate_id: i64,
    album_id: String,
) -> Result<crates::RemovedCrateAlbum, String> {
    state.with_storage(|storage| crates::remove_album(&mut storage.connection, crate_id, &album_id))
}

#[tauri::command]
fn undo_remove_crate_album(
    state: State<'_, DatabaseState>,
    crate_id: i64,
    album_id: String,
    position: i64,
    expected_album_ids: Vec<String>,
) -> Result<(), String> {
    state.with_storage(|storage| {
        crates::undo_remove_album(
            &mut storage.connection,
            crate_id,
            &album_id,
            position,
            &expected_album_ids,
        )
    })
}

#[tauri::command]
fn move_crate_album(
    state: State<'_, DatabaseState>,
    crate_id: i64,
    album_id: String,
    direction: crates::MoveDirection,
) -> Result<crates::Crate, String> {
    state.with_storage(|storage| {
        crates::move_album(&mut storage.connection, crate_id, &album_id, direction)
    })
}

#[tauri::command]
fn get_shelf(
    state: State<'_, DatabaseState>,
    shelf_id: i64,
) -> Result<shelves::ShelfLayout, String> {
    state.with_storage(|storage| shelves::load_shelf(&mut storage.connection, shelf_id))
}

#[tauri::command]
fn create_shelf(
    state: State<'_, DatabaseState>,
    settings: shelves::ShelfSettings,
) -> Result<shelves::Shelf, String> {
    state.with_storage(|storage| shelves::create_shelf(&storage.connection, settings))
}

#[tauri::command]
fn update_shelf(
    state: State<'_, DatabaseState>,
    shelf_id: i64,
    settings: shelves::ShelfSettings,
) -> Result<shelves::Shelf, String> {
    state.with_storage(|storage| shelves::update_shelf(&mut storage.connection, shelf_id, settings))
}

#[tauri::command]
fn delete_shelf(state: State<'_, DatabaseState>, shelf_id: i64) -> Result<usize, String> {
    state.with_storage(|storage| shelves::delete_shelf(&storage.connection, shelf_id))
}

#[tauri::command]
fn update_shelf_placements(
    state: State<'_, DatabaseState>,
    shelf_id: i64,
    changes: Vec<shelves::PlacementChange>,
    expected: Option<Vec<shelves::Placement>>,
) -> Result<Vec<shelves::Placement>, String> {
    state.with_storage(|storage| {
        shelves::update_placements_checked(&mut storage.connection, shelf_id, changes, expected)
    })
}

#[tauri::command]
fn get_profile(state: State<'_, DatabaseState>) -> Result<profile::Profile, String> {
    state
        .with_storage(|storage| profile::get(&storage.connection).map_err(database::database_error))
}

#[tauri::command]
fn set_display_name(state: State<'_, DatabaseState>, name: String) -> Result<(), String> {
    state.with_storage(|storage| profile::set_display_name(&storage.connection, &name))
}

#[tauri::command]
fn set_profile_picture(
    state: State<'_, DatabaseState>,
    change: database::ArtworkChange,
) -> Result<Option<String>, String> {
    state.with_storage(|storage| {
        profile::set_picture(&mut storage.connection, &storage.directory, change)
    })
}

fn file_operation_error(error: Box<dyn std::error::Error>, message: &str) -> String {
    if error.is::<std::io::Error>()
        || error.is::<tempfile::PersistError>()
        || error.is::<rusqlite::Error>()
        || error.is::<serde_json::Error>()
        || error.is::<zip::result::ZipError>()
        || error.is::<std::str::Utf8Error>()
    {
        return message.into();
    }
    // Filesystem helpers use explicit, path-free messages for validation failures.
    error.to_string()
}

#[tauri::command]
async fn export_collection_csv(
    app: AppHandle,
    include_wishlist: bool,
) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Export Hakoto collection")
            .set_file_name("hakoto-collection.csv")
            .add_filter("CSV files", &["csv"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| "Choose a local CSV file.")?;
        let library = app.state::<DatabaseState>().with_storage(|storage| {
            database::get_album_library(&mut storage.connection).map_err(database::database_error)
        })?;
        collection_csv::export(&path, library, include_wishlist).map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_collection_csv(app: AppHandle) -> Result<Option<CsvPreview>, String> {
    static NEXT_TOKEN: AtomicU32 = AtomicU32::new(1);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Import Hakoto collection")
            .add_filter("CSV files", &["csv"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| "Choose a local CSV file.")?;
        let text = collection_csv::read(&path)?;
        let state = app.state::<DatabaseState>();
        let (directory, prepared) = state.with_storage(|storage| {
            Ok((
                storage.directory.clone(),
                collection_csv::prepare(&storage.connection, &text)?,
            ))
        })?;
        let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
        let rows = prepared.preview();
        *state.csv_import.lock().map_err(|error| error.to_string())? = Some(PendingCsvImport {
            token,
            directory,
            prepared,
        });
        Ok(Some(CsvPreview { token, rows }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn discard_collection_csv_preview(
    state: State<'_, DatabaseState>,
    token: u32,
) -> Result<(), String> {
    let mut pending = state.csv_import.lock().map_err(|error| error.to_string())?;
    if pending
        .as_ref()
        .is_some_and(|pending| pending.token == token)
    {
        *pending = None;
    }
    Ok(())
}

#[tauri::command]
async fn import_collection_csv(
    app: AppHandle,
    token: u32,
    import_duplicates: Vec<usize>,
) -> Result<Vec<database::Album>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut pending = state.csv_import.lock().map_err(|error| error.to_string())?;
        let preview = pending
            .as_ref()
            .filter(|preview| preview.token == token)
            .ok_or("Preview the CSV again before importing.")?;
        let imported = state.with_storage(|storage| {
            if storage.directory != preview.directory {
                return Err(
                    "The storage location changed. Preview the CSV again before importing.".into(),
                );
            }
            collection_csv::import(
                &mut storage.connection,
                &preview.prepared,
                &import_duplicates,
            )
        })?;
        *pending = None;
        Ok(imported)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_backup(app: AppHandle, settings: backup::BackupSettings) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Create Hakoto backup")
            .set_file_name("hakoto-backup.zip")
            .add_filter("ZIP backup", &["zip"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "Choose a local backup file.")?;
        app.state::<DatabaseState>().with_storage(|storage| {
            backup::export(storage, &path, &settings)
                .map_err(|error| file_operation_error(error, "Could not create the backup. Check collection access, destination permissions, and free space."))
        })?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_backup_restore(app: AppHandle) -> Result<Option<backup::RestoreSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose a Hakoto backup")
            .add_filter("ZIP backup", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| "Choose a local backup file.")?;
        let state = app.state::<DatabaseState>();
        let (active_directory, parent) = state.with_storage(|storage| {
            Ok((
                storage.directory.clone(),
                storage.default_dir().to_path_buf(),
            ))
        })?;
        let staged = backup::stage(&path, &parent).map_err(|error| {
            file_operation_error(error, "Could not verify the backup. Check that the file is accessible and is a valid Hakoto backup.")
        })?;
        let summary = staged.summary.clone();
        *state
            .backup_restore
            .lock()
            .map_err(|error| error.to_string())? = Some(PendingBackupRestore {
            active_directory,
            staged,
        });
        Ok(Some(summary))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn discard_backup_restore(app: AppHandle, token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut pending = state
            .backup_restore
            .lock()
            .map_err(|error| error.to_string())?;
        if pending
            .as_ref()
            .is_some_and(|preview| preview.staged.summary.token == token)
        {
            *pending = None;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn confirm_backup_restore(app: AppHandle, token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut pending = state.backup_restore.lock().map_err(|error| error.to_string())?;
        if pending.as_ref().is_none_or(|preview| preview.staged.summary.token != token) {
            return Err("Choose the backup again before restoring.".into());
        }
        let preview = pending.take().unwrap();
        state.with_storage(|storage| {
            if storage.directory != preview.active_directory { return Err("The storage location changed. Choose the backup again before restoring.".into()); }
            storage.activate_restored(preview.staged.staging).map_err(|error| {
                let reason = file_operation_error(error, "Could not activate the staged backup. Check storage permissions and free space.");
                format!("{reason} Your original collection is still active.")
            })
        })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn pending_backup_settings(
    state: State<'_, DatabaseState>,
) -> Result<Option<backup::PendingSettings>, String> {
    state.with_storage(|storage| {
        backup::pending_settings(storage).map_err(|_| "Could not read restored preferences.".into())
    })
}

#[tauri::command]
fn finish_backup_settings(state: State<'_, DatabaseState>, token: String) -> Result<(), String> {
    state.with_storage(|storage| {
        backup::finish_settings(storage, &token)
            .map_err(|_| "Could not finish restoring preferences.".into())
    })
}

#[tauri::command]
fn get_storage_info(state: State<'_, DatabaseState>) -> Result<storage::StorageInfo, String> {
    state.with_storage(|storage| {
        storage
            .info()
            .map_err(|_| "Could not read collection storage information.".into())
    })
}

#[tauri::command]
fn open_storage_location(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    artwork: bool,
) -> Result<(), String> {
    let directory = state.with_storage(|storage| Ok(storage.directory.clone()))?;
    if artwork {
        let path =
            artwork::directory(&directory).map_err(|_| "The artwork folder is unavailable.")?;
        app.opener()
            .open_path(dunce::simplified(&path).to_string_lossy(), None::<&str>)
    } else {
        storage::checked_file(&directory.join(database::DATABASE_NAME))
            .map_err(|_| "The collection database file is unavailable.")?;
        app.opener()
            .reveal_item_in_dir(directory.join(database::DATABASE_NAME))
    }
    .map_err(|_| "Could not open the collection location in the file explorer.".into())
}

#[tauri::command]
async fn relocate_storage(app: AppHandle, restore_default: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let _relocation = state
            .relocation
            .try_lock()
            .map_err(|_| "A storage move is already in progress.")?;
        let destination = if restore_default {
            state.with_storage(|storage| Ok(storage.default_dir().to_path_buf()))?
        } else {
            let Some(folder) = app
                .dialog()
                .file()
                .set_title("Choose a folder for Hakoto collection storage")
                .blocking_pick_folder()
            else {
                return Ok(false);
            };
            folder
                .into_path()
                .map_err(|_| "Choose a local storage folder.")?
        };
        state.with_storage(|storage| {
            storage.relocate(&destination).map_err(|error| {
                let reason = file_operation_error(
                    error,
                    "Could not move the collection. Check destination permissions and free space.",
                );
                format!("{reason} Your original collection is still active.")
            })?;
            Ok(true)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn serve_image(
    request: http::Request<Vec<u8>>,
    read: impl FnOnce(&str) -> Option<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let name = request.uri().path().strip_prefix('/').unwrap_or_default();
    if request.method() == http::Method::GET
        && artwork::is_filename(name)
        && let Some(bytes) = read(name)
    {
        return http::Response::builder()
            .header(http::header::CONTENT_TYPE, "image/webp")
            .header(
                http::header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap();
    }

    http::Response::builder()
        .status(http::StatusCode::NOT_FOUND)
        .header(http::header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("artwork", |context, request| {
            let state = context.app_handle().try_state::<DatabaseState>();
            serve_image(request, |name| {
                state.as_ref().and_then(|state| {
                    state
                        .with_storage(|storage| Ok(artwork::read(&storage.directory, name)))
                        .ok()
                        .flatten()
                })
            })
        })
        .register_uri_scheme_protocol("profile-image", |context, request| {
            let state = context.app_handle().try_state::<DatabaseState>();
            serve_image(request, |name| {
                state.as_ref().and_then(|state| {
                    state
                        .with_storage(|storage| Ok(profile::read_image(&storage.directory, name)))
                        .ok()
                        .flatten()
                })
            })
        })
        .invoke_handler(tauri::generate_handler![
            get_crates,
            save_crate,
            delete_crate,
            add_crate_album,
            remove_crate_album,
            undo_remove_crate_album,
            move_crate_album,
            save_album,
            get_album_library,
            update_album,
            acquire_album,
            delete_album,
            delete_album_recoverable,
            get_deleted_albums,
            restore_deleted_album,
            discard_deleted_album,
            read_artwork_bytes,
            get_shelves,
            get_shelf,
            create_shelf,
            update_shelf,
            delete_shelf,
            update_shelf_placements,
            get_profile,
            set_display_name,
            set_profile_picture,
            get_storage_info,
            export_backup,
            preview_backup_restore,
            discard_backup_restore,
            confirm_backup_restore,
            pending_backup_settings,
            finish_backup_settings,
            export_collection_csv,
            preview_collection_csv,
            discard_collection_csv_preview,
            import_collection_csv,
            open_storage_location,
            relocate_storage
        ])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            let legacy_dir = (app.config().identifier == "com.hakoto.app")
                .then(|| app_dir.with_file_name("com.sleevy.app"));
            let storage = storage::Storage::open(&app_dir, legacy_dir.as_deref())
                .map(|mut storage| {
                    if let Err(error) =
                        artwork::ensure_directory(&storage.directory, storage::ARTWORK_DIRECTORY)
                    {
                        eprintln!("Could not create artwork directory: {error}");
                    }
                    if let Err(error) =
                        undo::purge_expired(&mut storage.connection, &storage.directory)
                    {
                        eprintln!("Could not expire deleted albums: {error}");
                    }
                    if let Err(error) = database::clean_orphaned_artwork(
                        &mut storage.connection,
                        &storage.directory,
                    ) {
                        eprintln!("Could not clean artwork directory: {error}");
                    }
                    if let Err(error) =
                        profile::clean_orphaned_images(&mut storage.connection, &storage.directory)
                    {
                        eprintln!("Could not clean profile images: {error}");
                    }
                    storage
                })
                .map_err(|error| {
                    eprintln!("Could not open Hakoto storage: {error}");
                    "Could not open Hakoto storage. Close any other Hakoto window, check that your collection drive is connected, and restart.".into()
                });
            app.manage(DatabaseState {
                storage: Mutex::new(storage),
                relocation: Mutex::new(()),
                csv_import: Mutex::new(None),
                backup_restore: Mutex::new(None),
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod image_response_tests {
    use super::*;

    #[test]
    fn immutable_images_are_cacheable_but_invalid_paths_and_missing_images_are_not() {
        let name = "00000000000000000000000000000001.webp";
        let response = serve_image(
            http::Request::builder()
                .uri(format!("artwork://localhost/{name}"))
                .body(Vec::new())
                .unwrap(),
            |_| Some(artwork::TEST_WEBP.to_vec()),
        );
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response.headers()[http::header::CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );
        assert_eq!(response.headers()[http::header::CONTENT_TYPE], "image/webp");
        for path in [
            "../private.webp",
            "%2e%2e%2fprivate.webp",
            "not-an-image",
            "00000000000000000000000000000001.webp/extra",
        ] {
            let response = serve_image(
                http::Request::builder()
                    .uri(format!("artwork://localhost/{path}"))
                    .body(Vec::new())
                    .unwrap(),
                |_| panic!("Invalid paths must not reach storage"),
            );
            assert_eq!(response.status(), http::StatusCode::NOT_FOUND);
            assert_eq!(response.headers()[http::header::CACHE_CONTROL], "no-store");
        }
        let response = serve_image(
            http::Request::builder()
                .uri(format!("artwork://localhost/{name}"))
                .body(Vec::new())
                .unwrap(),
            |_| None,
        );
        assert_eq!(response.headers()[http::header::CACHE_CONTROL], "no-store");
    }
}
