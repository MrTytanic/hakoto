use std::sync::Mutex;
use tauri::{Manager, State};

mod database;

struct DatabaseState {
    connection: Mutex<rusqlite::Connection>,
}

#[tauri::command]
fn save_album(
    state: State<'_, DatabaseState>,
    id: String,
    title: String,
    artist: String,
    format: String,
    release_year: String,
    artwork: Option<String>,
    favorite: bool,
) -> Result<usize, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|error| error.to_string())?;

    database::insert_album(
        &connection,
        &id,
        &title,
        &artist,
        &format,
        &release_year,
        artwork.as_deref(),
        favorite,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_albums(
    state: State<'_, DatabaseState>,
) -> Result<Vec<database::Album>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|error| error.to_string())?;

    database::get_albums(&connection)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_album(
    state: State<'_, DatabaseState>,
    id: String,
    title: String,
    artist: String,
    format: String,
    release_year: String,
    artwork: Option<String>,
    favorite: bool,
) -> Result<usize, String> {
    let connection = state
    .connection
    .lock()
    .map_err(|error| error.to_string())?;

    database::update_album(
        &connection,
        &id,
        &title,
        &artist,
        &format,
        &release_year,
        artwork.as_deref(),
        favorite,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_album(
    state: State<'_, DatabaseState>,
    id: String,
) -> Result<usize, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|error| error.to_string())?;

    database::delete_album(&connection, &id)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_album, get_albums, update_album, delete_album])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;

            std::fs::create_dir_all(&app_dir)?;

            let database_path = app_dir.join("sleevy.db");

            println!("Database path: {}", database_path.display());

            let connection = database::initialize_database(&database_path)?;

            app.manage(DatabaseState {
                connection: Mutex::new(connection),
            });

            println!("Successful Connection");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}