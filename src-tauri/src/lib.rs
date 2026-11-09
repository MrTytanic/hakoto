use tauri::Manager;
mod database;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            let database_path = app_dir.join("sleevy.db");
            println!("Database path: {}", database_path.display());

            let _connection = database::initialize_database(&database_path)?;

            println!("Successful Connection");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}