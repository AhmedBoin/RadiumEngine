// commands.rs — the four things the plugin does, all of them about tiles.
use crate::{CacheStats, PrefetchOptions, PrefetchProgress, RadiumCache, TileRequest};
use futures::stream::{self, StreamExt};
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter, Manager, Runtime, State};

fn sanitise(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .replace('.', "_")
}

/// Bing-style quadkey, used by the {q} placeholder.
fn quadkey(x: u32, y: u32, z: u32) -> String {
    let mut key = String::new();
    for i in (1..=z).rev() {
        let mask = 1u32 << (i - 1);
        let mut digit = 0;
        if x & mask != 0 {
            digit += 1;
        }
        if y & mask != 0 {
            digit += 2;
        }
        key.push(std::char::from_digit(digit, 10).unwrap_or('0'));
    }
    key
}

/// Turn a template into a real URL (the same rules as the TypeScript resolver).
pub fn resolve_url(template: &str, request: &TileRequest) -> String {
    let subdomain = request
        .subdomains
        .as_ref()
        .filter(|list| !list.is_empty())
        .map(|list| list[((request.x + request.y) as usize) % list.len()].clone())
        .unwrap_or_default();

    template
        .replace("{s}", &subdomain)
        .replace("{q}", &quadkey(request.x, request.y, request.z))
        .replace("{-y}", &((1u32 << request.z) - 1 - request.y).to_string())
        .replace("{z}", &request.z.to_string())
        .replace("{x}", &request.x.to_string())
        .replace("{y}", &request.y.to_string())
}

fn tile_path(root: &PathBuf, source_id: &str, z: u32, x: u32, y: u32) -> PathBuf {
    root.join(sanitise(source_id))
        .join(z.to_string())
        .join(x.to_string())
        .join(y.to_string())

/// Download many tiles with real parallelism. Emits `radium://progress` events.
#[command]
pub async fn prefetch_tiles<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, RadiumCache>,
    tiles: Vec<TileRequest>,
    options: Option<PrefetchOptions>,
) -> Result<PrefetchProgress, String> {
    let options = options.unwrap_or(PrefetchOptions { concurrency: 16, refresh: false });
    let root = state.root.clone();
    let total = tiles.len();

    let client = reqwest::Client::builder()
        .gzip(true)
        .build()
        .map_err(|error| error.to_string())?;

    let counter = std::sync::Arc::new(tokio::sync::Mutex::new(PrefetchProgress {
        done: 0,
        total,
        downloaded: 0,
        cached: 0,
        failed: 0,
        bytes: 0,
    }));

    let jobs = tiles.into_iter().map(|request| {
        let client = client.clone();
        let root = root.clone();
        let app = app.clone();
        let counter = counter.clone();
        let refresh = options.refresh;

        async move {
            let path = tile_path(&root, &request.source_id, request.z, request.x, request.y);

            if !refresh && path.exists() {
                let mut guard = counter.lock().await;
                guard.cached += 1;
                guard.done += 1;
                return Ok::<u64, String>(0);
            }

            let url = resolve_url(&request.url_template, &request);
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| error.to_string())?;
            let bytes = response.bytes().await.map_err(|error| error.to_string())?;

            if let Some(parent) = path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::write(&path, &bytes)
                .await
                .map_err(|error| error.to_string())?;

            let size = bytes.len() as u64;
            {
                let mut guard = counter.lock().await;
                guard.downloaded += 1;
                guard.bytes += size;
                guard.done += 1;
                let _ = app.emit("radium://progress", guard.clone());
            }
            Ok(size)
        }
    });

    let results = stream::iter(jobs)
        .buffer_unordered(options.concurrency.max(1))
        .collect::<Vec<Result<u64, String>>>()
        .await;

    let mut failed = 0usize;
    for result in results {
        if result.is_err() {
            failed += 1;
        }
    }
    if failed > 0 {
        counter.lock().await.failed = failed;
    }

    let progress = counter.lock().await.clone();
    Ok(progress)
}

/// Walk the cache folder and report entries + bytes (instant, no HTTP).
#[command]
pub async fn cache_stats(state: State<'_, RadiumCache>) -> Result<CacheStats, String> {
    let root = state.root.clone();
    let stats = tauri::async_runtime::spawn_blocking(move || {
        let mut entries = 0usize;
        let mut bytes = 0u64;
        for entry in walkdir::WalkDir::new(&root).into_iter().flatten() {
            if entry.file_type().is_file() {
                entries += 1;
                bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            }
        }
        (entries, bytes)
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(CacheStats {
        entries: stats.0,
        bytes: stats.1,
        location: root.to_string_lossy().to_string(),
    })
}

/// Delete the whole cache, or only one provider's folder.
#[command]
pub async fn clear_cache(
    state: State<'_, RadiumCache>,
    source_id: Option<String>,
) -> Result<(), String> {
    let path = match source_id {
        Some(id) => state.root.join(sanitise(&id)),
        None => state.root.clone(),
    };
    if path.exists() {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Sample a terrarium elevation tile at a pixel: no PNG decoding in the webview.
#[command]
pub async fn sample_elevation(
    state: State<'_, RadiumCache>,
    source_id: String,
    z: u32,
    x: u32,
    y: u32,
    px: u32,
    py: u32,
) -> Result<f32, String> {
    let path = tile_path(&state.root, &source_id, z, x, y);
    let file = std::fs::File::open(&path).map_err(|error| error.to_string())?;
    let decoder = png::Decoder::new(file);
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).map_err(|error| error.to_string())?;

    let channels = info.color_type.samples();
    let index = ((py as usize * info.width as usize) + px as usize) * channels;
    if index + 2 >= buffer.len() {
        return Err("pixel outside tile".into());
    }

    let r = buffer[index] as f32;
    let g = buffer[index + 1] as f32;
    let b = buffer[index + 2] as f32;
    Ok(r * 256.0 + g + b / 256.0 - 32768.0)
}

}
