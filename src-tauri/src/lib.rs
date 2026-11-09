use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State, http};

mod artwork;
mod database;

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

fn serve_artwork(
    app_dir: Option<&Path>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let name = request.uri().path().strip_prefix('/').unwrap_or_default();
    if request.method() == http::Method::GET
        && let Some(bytes) = app_dir.and_then(|dir| artwork::read(dir, name))
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
            serve_artwork(state.as_ref().map(|state| state.app_dir.as_path()), request)
        })
        .invoke_handler(tauri::generate_handler![
            save_album,
            get_albums,
            update_album,
            delete_album
        ])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_dir)?;

            let mut connection = database::initialize_database(&app_dir.join("sleevy.db"))?;
            if let Err(error) = fs::create_dir_all(app_dir.join("artwork")) {
                eprintln!("Could not create artwork directory: {error}");
            }
            if let Err(error) = database::clean_orphaned_artwork(&mut connection, &app_dir) {
                eprintln!("Could not clean artwork directory: {error}");
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
