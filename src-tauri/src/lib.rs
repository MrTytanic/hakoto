use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State, http};

mod artwork;
mod database;
mod profile;

struct DatabaseState {
    connection: Mutex<rusqlite::Connection>,
    app_dir: PathBuf,
}

#[tauri::command]
fn save_album(
    state: State<'_, DatabaseState>,
    album: database::Album,
    artwork: Option<Vec<u8>>,
) -> Result<database::Album, String> {
    let mut connection = state.connection.lock().map_err(|error| error.to_string())?;
    database::save_album(&mut connection, &state.app_dir, album, artwork)
}

#[tauri::command]
fn get_albums(state: State<'_, DatabaseState>) -> Result<Vec<database::Album>, String> {
    let connection = state.connection.lock().map_err(|error| error.to_string())?;
    database::get_albums(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_album(
    state: State<'_, DatabaseState>,
    album: database::Album,
    artwork: Option<database::ArtworkChange>,
) -> Result<database::Album, String> {
    let mut connection = state.connection.lock().map_err(|error| error.to_string())?;
    database::update_album(&mut connection, &state.app_dir, album, artwork)
}

#[tauri::command]
fn delete_album(state: State<'_, DatabaseState>, id: String) -> Result<usize, String> {
    let mut connection = state.connection.lock().map_err(|error| error.to_string())?;
    database::delete_album(&mut connection, &state.app_dir, &id)
}

#[tauri::command]
fn get_profile(state: State<'_, DatabaseState>) -> Result<profile::Profile, String> {
    let connection = state.connection.lock().map_err(|error| error.to_string())?;
    profile::get(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_display_name(state: State<'_, DatabaseState>, name: String) -> Result<(), String> {
    let connection = state.connection.lock().map_err(|error| error.to_string())?;
    profile::set_display_name(&connection, &name).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_profile_picture(
    state: State<'_, DatabaseState>,
    change: database::ArtworkChange,
) -> Result<Option<String>, String> {
    let mut connection = state.connection.lock().map_err(|error| error.to_string())?;
    profile::set_picture(&mut connection, &state.app_dir, change).map_err(|error| error.to_string())
}

fn serve_image(
    request: http::Request<Vec<u8>>,
    read: impl FnOnce(&str) -> Option<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let name = request.uri().path().strip_prefix('/').unwrap_or_default();
    if request.method() == http::Method::GET
        && let Some(bytes) = read(name)
    {
        return http::Response::builder()
            .header(http::header::CONTENT_TYPE, "image/webp")
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap();
    }

    http::Response::builder()
        .status(http::StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("artwork", |context, request| {
            let state = context.app_handle().try_state::<DatabaseState>();
            serve_image(request, |name| {
                state
                    .as_ref()
                    .and_then(|state| artwork::read(&state.app_dir, name))
            })
        })
        .register_uri_scheme_protocol("profile-image", |context, request| {
            let state = context.app_handle().try_state::<DatabaseState>();
            serve_image(request, |name| {
                state
                    .as_ref()
                    .and_then(|state| profile::read_image(&state.app_dir, name))
            })
        })
        .invoke_handler(tauri::generate_handler![
            save_album,
            get_albums,
            update_album,
            delete_album,
            get_profile,
            set_display_name,
            set_profile_picture
        ])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_dir)?;

            let legacy_dir = (app.config().identifier == "com.hakoto.app")
                .then(|| app_dir.with_file_name("com.sleevy.app"));
            let mut connection = database::initialize_database(&app_dir, legacy_dir.as_deref())
                .map_err(|error| {
                    std::io::Error::other(format!("Could not open the collection: {error}"))
                })?;
            if let Err(error) = fs::create_dir_all(app_dir.join("artwork")) {
                eprintln!("Could not create artwork directory: {error}");
            }
            if let Err(error) = database::clean_orphaned_artwork(&mut connection, &app_dir) {
                eprintln!("Could not clean artwork directory: {error}");
            }
            if let Err(error) = profile::clean_orphaned_images(&mut connection, &app_dir) {
                eprintln!("Could not clean profile images: {error}");
            }

            app.manage(DatabaseState {
                connection: Mutex::new(connection),
                app_dir,
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
