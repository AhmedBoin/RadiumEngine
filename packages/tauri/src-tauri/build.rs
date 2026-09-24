fn main() {
    tauri_plugin::Builder::new(&[]).try_build().expect("failed to build tauri plugin");
}
