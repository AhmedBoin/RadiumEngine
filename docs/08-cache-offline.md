# 8. Caching and offline

Every tile — imagery **and** terrain — goes through one cache-first pipeline. Nothing
is ever downloaded twice, and 2D and 3D share the same cache, so panning in 2D warms
the 3D map.

```
get(source, {z,x,y})
      │
      ├─ in cache?  ── yes ─▶ return the bytes (no network)
      │
      └─ no ─▶ download ─▶ transforms ─▶ store ─▶ return
                 │
                 └─ in-flight requests for the same tile share ONE download
```

## Choosing an adapter

```tsx
<MapProvider options={{ cache: { kind: "auto", rootDir: "MyApp/tiles" } }}>
```

| `kind` | storage | when |
| --- | --- | --- |
| `"auto"` | Tauri fs inside Tauri, otherwise IndexedDB | the default; correct in every environment |
| `"tauri-fs"` | a real folder on disk | desktop apps that want to inspect or ship cache folders |
| `"indexeddb"` | an IndexedDB database | pure web apps |
| `"memory"` | RAM only (LRU) | tests, private browsing, no persistence wanted |
| `"none"` | nothing | always online, no disk usage |

| option | default | meaning |
| --- | --- | --- |
| `rootDir` | `RadiumEngine/tiles` | folder inside the app data dir (Tauri) |
| `baseDir` | Tauri `Document` | the `BaseDirectory` that `rootDir` is resolved against |
| `maxBytes` | 64 MB | memory L1 (in front of the disk) soft limit |
| `maxEntries` | 4096 | memory L1 entry limit |
| `database` | `radium-engine` | IndexedDB database name |
| `enabled` | `true` | `false` = no cache at all (live only) |

Except `"none"` and `"memory"`, every adapter is wrapped with a memory L1 tier, so
recent tiles are served without touching disk.

## The on-disk layout (identical in TypeScript and Rust)

```text
<cache root>/
  Terrarium/12/1093/728                ← DEM (AWS terrarium)
  Terrarium_S2/12/1093/728             ← the same DEM, smoothed (its own folder)
  USGS_3DEP/12/1093/728                ← 3DEP GeoTIFF, converted to terrarium PNG
  ESRI_WorldImagery/12/1093/728        ← imagery
  Carto_DarkMatter/12/1093/728
  LocalDEM/11/546/364
```

The rule is `<folder>/<z>/<x>/<y>` with **no extension** (a tile may be PNG, JPEG,
WebP or GeoTIFF). Folders are the provider id with dots replaced by underscores, except
for terrain, which uses the friendly names in the
[terrain table](./07-providers.md#terrain-providers). This layout is what both the JS
adapters and the Rust accelerator write, and it is stable: you can zip it, ship it, or
point another machine at it.

## Prefetching an area (offline use)

```tsx
import { tilesForBounds, useMapApi, useMapEngine } from "@radium-engine/react";

function PrefetchButton() {
  const api = useMapApi();
  const { pipeline, imagery, terrain } = useMapEngine();
  const [progress, setProgress] = useState("");

  const run = async () => {
    if (!pipeline) return;
    const camera = api.getCamera();
    const span = 0.05;                        // ≈ 5 km half-span
    const bounds = {
      west: camera.lon - span, east: camera.lon + span,
      south: camera.lat - span, north: camera.lat + span,
    };

    // 1. imagery for the current zoom and one level deeper
    const imageryTiles = tilesForBounds(bounds, Math.floor(camera.zoom), Math.floor(camera.zoom) + 1, 5000);
    await pipeline.prefetch(
      { id: imagery.id, url: imagery.url, subdomains: imagery.subdomains, maxZoom: imagery.maxZoom ?? 19 },
      imageryTiles,
      { concurrency: 8, onProgress: (p) => setProgress(`imagery ${p.done}/${p.total}`) },
    );

    // 2. terrain (the DEM that makes 3D correct)
    if (terrain) {
      const demTiles = tilesForBounds(bounds, 11, Math.min(13, terrain.maxZoom), 2000);
      await pipeline.prefetch(terrain, demTiles, {
        onProgress: (p) => setProgress(`terrain ${p.done}/${p.total}`),
      });
    }
    setProgress("offline ready");
  };

  return <button onClick={() => void run()}>{progress || "Prefetch area"}</button>;
}
```

`prefetch` reports real numbers:

```ts
type PrefetchProgress = {
  done: number; total: number;
  downloaded: number;   // new tiles fetched now
  cached: number;       // already present, skipped
  failed: number; bytes: number;
};
```

Options: `concurrency` (default 6), `signal` (`AbortSignal` to cancel), `onProgress`,
`refresh` (re-download even when cached).


Practical guidance:

- Prefetch what the user actually views: the visible bounds plus one zoom level, then
  the DEM at 11–13. A city-sized imagery area at zoom 14–16 is a few thousand tiles.
- `cached` in the progress tells you the second run is free — that is your proof the
  cache works.
- Cancel long runs when the user closes the dialog: keep an `AbortController` and pass
  its `signal`.
- The browser is limited to ~6 concurrent sockets; the
  [Rust accelerator](./11-tauri-integration.md) does 16+ and is far faster for large
  areas.

## Inspecting and clearing the cache

```tsx
const { status, pipeline } = useMapEngine();

await status();                                        // { adapter, entries, bytes }
await pipeline?.stats();                               // same, straight from the adapter
await pipeline?.adapter.clear();                       // everything
await pipeline?.adapter.clear("Terrarium");            // one provider folder
await pipeline?.adapter.keys?.("ESRI_WorldImagery/12"); // enumerate (fs / IndexedDB / memory)
```

A settings screen is a dozen lines:

```tsx
function OfflinePanel() {
  const { status, pipeline } = useMapEngine();
  const [stats, setStats] = useState({ adapter: "", entries: 0, bytes: 0 });
  const refresh = () => void status().then(setStats);

  useEffect(refresh, [status]);

  return (
    <div>
      <p>
        {stats.adapter} · {stats.entries} tiles · {(stats.bytes / 1048576).toFixed(1)} MB
      </p>
      <button onClick={refresh}>Refresh</button>
      <button onClick={() => void pipeline?.adapter.clear().then(refresh)}>Clear cache</button>
    </div>
  );
}
```

## Using the pipeline without React

```ts
import {
  createCache, TilePipeline, defaultTileTransforms, terrainSourceFor, tilesForBounds,
} from "@radium-engine/core";

const cache = await createCache({ kind: "auto", rootDir: "MyApp/tiles" });
const pipeline = new TilePipeline({
  cache,
  transforms: defaultTileTransforms,          // GeoTIFF → terrarium, DEM smoothing
  concurrency: 8,
  onEvent: (event) => console.log(event.type),
});

const dem = terrainSourceFor({ provider: "aws-terrarium", smoothing: 2 });
await pipeline.prefetch(dem, tilesForBounds(bounds, 11, 13), { onProgress: console.log });

const bytes = await pipeline.get(dem, { z: 12, x: 1093, y: 728 });
```

A custom transport is one function — useful for a corporate proxy, a Rust command, or a
test double:

```ts
new TilePipeline({
  cache,
  fetchTile: async (url, _tile, source) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`${response.status} for ${source.id}`);
    return response.arrayBuffer();
  },
});
```

## Cache correctness guarantees

1. **Key stability** — `<folder>/<z>/<x>/<y>`; changing a DEM's smoothing level yields a
   different folder, never a mixed cache.
2. **No half-written tiles** — the browser adapters write after the download resolves;
   the fs adapter creates the directory chain first.
3. **Failed downloads are not cached** — a miss stays a miss, so a retry works.
4. **One file layout, two languages** — the Rust accelerator writes exactly this layout,
   so a cache filled by Rust is readable by the webview and vice versa.

Next: [terrain and elevation](./09-terrain-elevation.md).
