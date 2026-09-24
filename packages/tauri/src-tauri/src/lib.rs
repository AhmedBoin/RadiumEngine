//! RadiumEngine Tauri plugin — the optional accelerator.
//!
//! The JavaScript side of RadiumEngine already works without this crate (it
//! downloads tiles with `fetch` and stores them through the fs plugin). This
//! plugin exists so desktop apps can:
//!
//! * **prefetch** an area with real parallelism and progress events (the browser
//!   is limited to ~6 sockets, this is limited by the CPU and the network),
//! * **inspect and clear** the on-disk tile cache instantly,
//! * **sample the DEM** (terrarium PNG or GeoTIFF) without decoding PNG in the
//!   webview, which is what makes offline terrain cheap on low-end machines.
//!
//! Layout of the cache is identical to the JavaScript adapters, so a cache filled
//! by the browser and a cache filled here are the same cache:
//!
//! ```text
//! <cache_root>/<folder>/<z>/<x>/<y>
//! ```
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{plugin::TauriPlugin, Manager, Runtime};

mod commands;
pub use commands::*;

/// Plugin state: where the tiles live.
pub struct RadiumCache {
    pub root: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileRequest {
    /// Provider id, e.g. "ESRI.WorldImagery" or "Terrarium".
    pub source_id: String,
    /// URL template with {z} {x} {y} ({s} subdomain, {q} quadkey).
    pub url_template: String,
    pub subdomains: Option<Vec<String>>,
    pub z: u32,
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchProgress {
    pub done: usize,
    pub total: usize,
    pub downloaded: usize,
    pub cached: usize,
    pub failed: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub entries: usize,
    pub bytes: u64,
    pub location: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchOptions {
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    /// Re-download tiles even when they are already cached.
    #[serde(default)]
    pub refresh: bool,
}

fn default_concurrency() -> usize {
    16
}

/// Build the plugin with a fixed cache location.
pub fn init<R: Runtime>(cache_root: impl AsRef<Path>) -> TauriPlugin<R> {
    let root = PathBuf::from(cache_root.as_ref());
    tauri::plugin::Builder::<R>::new("radium-engine")
        .invoke_handler(tauri::generate_handler![
            commands::prefetch_tiles,
            commands::cache_stats,
            commands::clear_cache,
            commands::sample_elevation,
        ])
        .setup(move |app, _api| {
            app.manage(RadiumCache { root: root.clone() });
            Ok(())
        })
        .build()
}

/// Shortcut for the common case: cache inside the app's data directory.
pub fn init_in_app_data<R: Runtime>(app: &tauri::AppHandle<R>) -> TauriPlugin<R> {
    let root = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("RadiumEngine/tiles");
    init(root)
}
