use std::{fs, sync::Mutex};
use tauri::{AppHandle, Manager, State, http};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

mod artwork;
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
}

impl DatabaseState {
    fn with_storage<T>(
        &self,
        action: impl FnOnce(&mut storage::Storage) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.storage.lock().map_err(|error| error.to_string())?;
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
        database::get_album_library(&mut storage.connection).map_err(|error| error.to_string())
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
) -> Result<crates::Crate, String> {
    state.with_storage(|storage| crates::remove_album(&mut storage.connection, crate_id, &album_id))
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
    state.with_storage(|storage| {
        profile::get(&storage.connection).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn set_display_name(state: State<'_, DatabaseState>, name: String) -> Result<(), String> {
    state.with_storage(|storage| {
        profile::set_display_name(&storage.connection, &name).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn set_profile_picture(
    state: State<'_, DatabaseState>,
    change: database::ArtworkChange,
) -> Result<Option<String>, String> {
    state.with_storage(|storage| {
        profile::set_picture(&mut storage.connection, &storage.directory, change)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn get_storage_info(state: State<'_, DatabaseState>) -> Result<storage::StorageInfo, String> {
    state.with_storage(|storage| storage.info().map_err(|error| error.to_string()))
}

#[tauri::command]
fn open_storage_location(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    artwork: bool,
) -> Result<(), String> {
    let directory = state.with_storage(|storage| Ok(storage.directory.clone()))?;
    if artwork {
        let path = artwork::directory(&directory).map_err(|error| error.to_string())?;
        app.opener()
            .open_path(dunce::simplified(&path).to_string_lossy(), None::<&str>)
    } else {
        app.opener()
            .reveal_item_in_dir(directory.join(database::DATABASE_NAME))
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn relocate_storage(app: AppHandle, restore_default: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let _relocation = state.relocation.try_lock().map_err(|_| "A storage move is already in progress.")?;
        let destination = if restore_default {
            state.with_storage(|storage| Ok(storage.default_dir().to_path_buf()))?
        } else {
            let Some(folder) = app.dialog().file().set_title("Choose a folder for Hakoto collection storage").blocking_pick_folder() else {
                return Ok(false);
            };
            folder.into_path().map_err(|error| error.to_string())?
        };
        state.with_storage(|storage| {
            storage.relocate(&destination).map_err(|error| format!(
                "Could not move the collection to {}: {error}. The original collection is still active at {}.",
                destination.display(), storage.directory.display(),
            ))?;
            Ok(true)
        })
    }).await.map_err(|error| error.to_string())?
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
                        fs::create_dir_all(storage.directory.join(storage::ARTWORK_DIRECTORY))
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
                .map_err(|error| error.to_string());
            app.manage(DatabaseState {
                storage: Mutex::new(storage),
                relocation: Mutex::new(()),
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
