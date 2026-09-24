# 11. Tauri integration (the optional Rust accelerator)

RadiumEngine works in any webview with **zero** Rust: it downloads tiles with `fetch`
and stores them through `@tauri-apps/plugin-fs`. The accelerator exists for three things
a browser cannot do well:

| capability | why Rust |
| --- | --- |
| bulk prefetch | browsers cap at ~6 sockets; Rust runs 16+ and emits progress events |
| cache inspection / clearing | walking a tree with thousands of files is instant in Rust, slow through the fs plugin |
| DEM sampling | decoding PNG tiles in Rust keeps the webview main thread free on low-end machines |

Everything is optional and degrades gracefully: when the plugin is missing, the JS
functions return `null`/`false` and the TypeScript path is used.

## 1. Add the crate

`src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"

# path while developing against a local checkout; use a published version later
tauri-plugin-radium-engine = { path = "../../RadiumEngine/packages/tauri/src-tauri" }
```

## 2. Register the plugin

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_radium_engine::init("RadiumEngine/tiles"))
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
```

`init(cache_root)` takes the folder tiles live in — keep it identical to the
`cache.rootDir` you pass to `<MapProvider>`, so the webview and Rust share one cache.
Inside a Tauri app you can also resolve it against the app data dir:

```rust
let handle = app.handle().clone();
tauri_plugin_radium_engine::init_in_app_data(&handle);   // <appData>/RadiumEngine/tiles
```

## 3. Allow the commands

Tauri 2 decides what the webview may call. In `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:default",
    { "identifier": "fs:allow-appdata-write-recursive", "allow": [{ "path": "$APPDATA/**" }] },
    { "identifier": "fs:allow-appdata-read-recursive", "allow": [{ "path": "$APPDATA/**" }] },
    "radium-engine:default"
  ]
}
```

The plugin declares its four commands in
`packages/tauri/src-tauri/permissions/default.toml`; without the capability entry the
webview gets `plugin not found` / `not allowed`.

## 4. Install the JavaScript side

```bash
npm install @radium-engine/tauri @tauri-apps/api @tauri-apps/plugin-fs
```

## 5. Use it

```tsx
import { isAcceleratorAvailable, prefetchTiles } from "@radium-engine/tauri";
import { tilesForBounds, useMapApi, useMapEngine } from "@radium-engine/react";

function RustPrefetch() {
  const api = useMapApi();
  const { imagery, terrain } = useMapEngine();
  const [text, setText] = useState("");
  const [available, setAvailable] = useState(false);

  useEffect(() => void isAcceleratorAvailable().then(setAvailable), []);

  const run = async () => {
    if (!available) return setText("accelerator not installed");
    const camera = api.getCamera();
    const bounds = {
      west: camera.lon - 0.05, east: camera.lon + 0.05,
      south: camera.lat - 0.05, north: camera.lat + 0.05,
    };

    const result = await prefetchTiles({
      sourceId: imagery.id,
      urlTemplate: imagery.url,
      subdomains: imagery.subdomains?.map(String),
      tiles: tilesForBounds(bounds, Math.floor(camera.zoom), Math.floor(camera.zoom) + 2, 20000),
      concurrency: 24,
      onProgress: (p) => setText(`${p.done}/${p.total} · ${(p.bytes / 1048576).toFixed(1)} MB`),
    });

    if (terrain) {
      await prefetchTiles({
        sourceId: terrain.folder,
        urlTemplate: terrain.url,
        tiles: tilesForBounds(bounds, 11, Math.min(13, terrain.maxZoom), 5000),
        concurrency: 24,
      });
    }
    setText(`done: ${result.downloaded} new, ${result.cached} cached, ${result.failed} failed`);
  };

  return <button onClick={() => void run()}>{text || "Rust prefetch"}</button>;
}
```

Full JS API:

```ts
isAcceleratorAvailable(): Promise<boolean>
prefetchTiles({
  sourceId: string; urlTemplate: string; subdomains?: (string | number)[];
  tiles: { z: number; x: number; y: number }[];
  concurrency?: number; refresh?: boolean;
  onProgress?: (p: PrefetchProgress) => void;
}): Promise<PrefetchProgress>
cacheStats(): Promise<CacheStats | null>
clearCache(sourceId?: string): Promise<boolean>
sampleElevation({ sourceId, lat, lon, zoom? }): Promise<number | null>
createAcceleratedCache(): Promise<CacheAdapter | null>
```


## 6. The Rust commands (for reference)

```rust
#[tauri::command] prefetch_tiles(app, state, tiles, options) -> PrefetchProgress
#[tauri::command] cache_stats(state) -> CacheStats
#[tauri::command] clear_cache(state, source_id: Option<String>) -> ()
#[tauri::command] sample_elevation(state, source_id, z, x, y, px, py) -> f32
```

`prefetch_tiles` emits `radium://progress` with the same `PrefetchProgress` shape the
TypeScript pipeline reports, so one progress UI can drive both paths.

## 7. Build and ship

```bash
npm --workspace @radium-engine/tauri run build:rust   # cargo build the plugin
npm --workspace apps/playground run build             # vite build the frontend
npm --workspace templates/starter run desktop         # tauri dev
```

Two things keep native builds fast:

- add `.cargo/config.toml` with `[build] jobs = 2` if the linker runs out of memory,
- keep `bundle.targets` to the platforms you actually ship (`"nsis"` on Windows is far
  faster than `"all"`).

## Notes and gotchas

- **The cache is shared, not duplicated**: both sides write
  `<root>/<folder>/<z>/<x>/<y>`, so a Rust prefetch is immediately visible to the
  webview and vice versa.
- **`sourceId` is the cache folder** — `Terrarium`, `Terrarium_S2`, `USGS_3DEP` for
  terrain (use `terrain.folder`), the provider id for imagery.
- **The plugin never replaces the pipeline**: after a Rust prefetch the map still reads
  through `TilePipeline` (cache hits, no network).
- **Nothing else in RadiumEngine changes** whether the plugin is present or not.

Next: [integration recipes](./12-integration-recipes.md).
