// Tauri entry point: registers the optional RadiumEngine accelerator plugin.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_radium_engine::init(
            // where tiles live on disk (same layout the JavaScript cache uses)
            "RadiumEngine/tiles",
        ))
        .run(tauri::generate_context!())
        .expect("error while running the RadiumEngine app");
}
