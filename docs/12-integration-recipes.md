# 12. Integration recipes

Pick the one that matches your situation. Each recipe is complete — no "…" steps.

## 0. Which packages do I need?

| you want | install |
| --- | --- |
| a 2D or 3D map in a React app | `@radium-engine/react` + `leaflet` + `maplibre-gl` + `three` |
| only 2D | the same (the 3D engine is only loaded when `mode === "3d"`) |
| only the data layer (tiles, cache, DEM, tracks) | `@radium-engine/core` |
| native disk cache + fast bulk prefetch in Tauri | `+ @radium-engine/tauri` |
| GeoTIFF terrain (USGS 3DEP, local DEMs) | `+ geotiff` |

## 1. New app from the starter (5 minutes)

```bash
cp -r templates/starter ../my-map-app
cd ../my-map-app
npm install
npm run dev            # browser at http://localhost:5183
npm run desktop        # Tauri window (needs the Rust toolchain)
```

Then edit `src/App.tsx` (configuration + scene) and `src/telemetry.ts` (your feed).

## 2. Add it to an existing React app

```bash
npm install @radium-engine/core @radium-engine/react leaflet maplibre-gl three
```

Your entry file, once:

```ts
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
```

A component — the container **must have a height**:

```tsx
// src/components/MapPanel.tsx
import { MapProvider, MapView, MapObject, useSimulatedTraffic } from "@radium-engine/react";

export function MapPanel() {
  const traffic = useSimulatedTraffic(true, 3);

  return (
    <MapProvider
      options={{
        mode: "3d",
        imagery: "ESRI.WorldImagery",
        terrain: { provider: "aws-terrarium", smoothing: 1 },
        exaggeration: 1.25,
        camera: { lat: 30.0444, lon: 31.2357, zoom: 13, pitch: 55 },
        cache: { kind: "auto", rootDir: "MyApp/tiles" },
      }}
    >
      <div style={{ height: "70vh", width: "100%", position: "relative" }}>
        <MapView />
        <ModeButton />
      </div>

      {traffic.map((item) => (
        <MapObject key={item.id} id={item.id} pose6={item.pose6} motion={{ mode: "smooth" }} dropLine />
      ))}
    </MapProvider>
  );
}
```

Scene components (`<MapObject>`, `<Track>`, …) render nothing themselves, so they can
live anywhere inside the provider — including inside your own layouts.

### Replacing `react-leaflet`

| react-leaflet | RadiumEngine |
| --- | --- |
| `<MapContainer center zoom>` | `<MapProvider options={{ camera: {…} }}>` |
| `<TileLayer url>` | `options.imagery` (16 providers built in, cached) |
| `<Marker position>` | `<MapObject pose6>` / `<Marker pose>` |
| `<Polyline positions>` | `<Polyline points>` |
| `<Circle center radius>` | `<Circle center radiusM>` |
| `useMap()` | `useMapApi()` / `useMapEngine()` |
| manual flyTo / fitBounds | `api.flyTo()` / `api.fitBounds()` |
| — | `<Polygon extrudeM>` in 3D, terrain, tracks, motion, offline cache |

Delete the `react-leaflet` dependency once every layer has moved; Leaflet itself stays
(it is the 2D engine).

### Slowly: start 2D-only, add 3D later

```tsx
// day 1 — 2D only, no 3D dependencies downloaded at runtime
<MapProvider options={{ mode: "2d", imagery: "OpenStreetMap.Standard" }}>

// day 30 — same tree, one prop
<MapProvider options={{ mode: "3d", terrain: { provider: "aws-terrarium" } }}>
```

Because the scene is declarative and engine-independent, adding 3D later is a
configuration change, not a rewrite.

### Lazy-load the engine (keeps the initial bundle small)

```tsx
import { lazy, Suspense } from "react";

const MapPanel = lazy(() => import("./components/MapPanel"));

export function App() {
  return (
    <Suspense fallback={<div style={{ height: "70vh" }}>Loading the map…</div>}>
      <MapPanel />
    </Suspense>
  );
}
```


## 3. Add it to an existing Tauri app

1. JavaScript: `npm install @radium-engine/core @radium-engine/react @radium-engine/tauri leaflet maplibre-gl three @tauri-apps/api @tauri-apps/plugin-fs`
2. Rust: add `tauri-plugin-fs = "2"` and `tauri-plugin-radium-engine = { path = "…" }`, then
   `.plugin(tauri_plugin_fs::init())` and
   `.plugin(tauri_plugin_radium_engine::init("RadiumEngine/tiles"))`.
3. Capabilities: add `"fs:default"`, the two `fs:allow-appdata-*-recursive` entries and
   `"radium-engine:default"` (see [the Tauri guide](./11-tauri-integration.md#3-allow-the-commands)).
4. Point the map at the same folder so cache and Rust agree:

```tsx
<MapProvider options={{ cache: { kind: "auto", rootDir: "RadiumEngine/tiles" } }}>
```

5. Optional: `npm run build:rust` in `packages/tauri` to build the plugin, then use
   `prefetchTiles()` for bulk downloads.

Nothing else changes: the same component tree runs in the browser and in the window.

## 4. Core-only, headless (no React, no map)

For a Node CLI, a worker, a test suite, or a "download this area before the flight" tool.

```ts
// tools/prefetch-area.ts
import {
  createCache, TilePipeline, defaultTileTransforms, terrainSourceFor,
  imageryProviderFor, tilesForBounds,
} from "@radium-engine/core";

const area = { west: 31.1, south: 30.0, east: 31.4, north: 30.2 };
const cache = await createCache({ kind: "memory" });            // or tauri-fs on desktop
const pipeline = new TilePipeline({ cache, transforms: defaultTileTransforms, concurrency: 12 });

const imagery = imageryProviderFor("ESRI.WorldImagery");
await pipeline.prefetch(
  { id: imagery.id, url: imagery.url, subdomains: imagery.subdomains, maxZoom: imagery.maxZoom },
  tilesForBounds(area, 12, 15, 40000),
  { onProgress: (p) => process.stdout.write(`\rimagery ${p.done}/${p.total}`) },
);

const dem = terrainSourceFor({ provider: "aws-terrarium", smoothing: 1 });
await pipeline.prefetch(dem, tilesForBounds(area, 11, 13, 5000), {
  onProgress: (p) => process.stdout.write(`\rterrain ${p.done}/${p.total}`),
});

console.log("\ncache:", await pipeline.stats());
```

Motion, tracks and the scene store work headlessly too — that is how you unit-test
telemetry handling:

```ts
const store = new SceneStore();
store.setPose("uav-1", pose, { mode: "smooth", lagMs: 200 });
store.ensureTrack("uav-1", { maxMetres: 1000 }).push({ lat: 30, lon: 31, alt: 120 });
console.log(store.displayPose("uav-1"), store.getTrack("uav-1")?.lengthMeters);
```

## 5. Driving the map from non-React code

Telemetry, workers, sagas, Redux listeners, WebSocket callbacks — none of them need React:

```ts
// mapController.ts — created once, used from anywhere
import type { SceneStore, Pose6 } from "@radium-engine/core";

let store: SceneStore | null = null;

export function attachStore(next: SceneStore) {
  store = next;
}

export function onTelemetry(frame: { id: string; lat: number; lon: number; alt: number; heading: number }) {
  const pose: Pose6 = { lat: frame.lat, lon: frame.lon, alt: frame.alt, roll: 0, pitch: 0, yaw: frame.heading };
  store?.setPose(frame.id, pose, { mode: "smooth", lagMs: 250 });
}
```

```tsx
function Attach() {
  const { store } = useMapEngine();
  useEffect(() => {
    attachStore(store);
    return () => attachStore(null);
  }, [store]);
  return null;
}
```

## 6. Two maps side by side (2D and 3D at once)

Each `<MapProvider>` owns its own store, so two providers are two independent maps:

```tsx
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, height: "80vh" }}>
  <MapProvider options={{ mode: "2d", imagery: "Carto.DarkMatter", camera }}>
    <div style={{ height: "100%" }}><MapView /></div>
    {shared.map((v) => <MapObject key={v.id} id={v.id} pose6={v.pose} />)}
  </MapProvider>

  <MapProvider options={{ mode: "3d", terrain: { provider: "aws-terrarium" }, camera }}>
    <div style={{ height: "100%" }}><MapView /></div>
    {shared.map((v) => <MapObject key={v.id} id={v.id} pose6={v.pose} dropLine />)}
  </MapProvider>
</div>
```

The two panes share the **cache** (same `rootDir`), not the store — which is right when
each pane may show different layers. If you want one store and two engines, use the

## 7. Next.js / SSR

Both engines are client-only (they need `window`, WebGL and the DOM). Import them
dynamically:

```tsx
"use client";
import dynamic from "next/dynamic";

const MapPanel = dynamic(() => import("@/components/MapPanel"), {
  ssr: false,
  loading: () => <div style={{ height: "70vh" }} />,
});

export default function Page() {
  return <MapPanel />;
}
```

`@radium-engine/core` is SSR-safe (geo, providers, tracks, cache and DEM math touch no
browser API until you call something that needs one), so you can compute tiles, prefetch
lists and track statistics on the server.

## 8. Electron

Identical to the browser recipe, with one extra: point the cache at a writable location.
The default `"auto"` already falls back to IndexedDB outside Tauri:

```tsx
<MapProvider options={{ cache: { kind: "indexeddb", database: "my-app-tiles" } }}>
```

For a real disk cache in the main process, pass your own adapter through the core
pipeline (`new TilePipeline({ cache: myElectronFsAdapter })`) — the `CacheAdapter`
interface is five methods.

## 9. Linking the packages in a monorepo

```jsonc
// package.json of your app
{
  "dependencies": {
    "@radium-engine/core": "file:../RadiumEngine/packages/core",
    "@radium-engine/react": "file:../RadiumEngine/packages/react"
  }
}
```

- npm/yarn workspaces: `"workspaces": ["RadiumEngine/packages/*", "apps/*"]`, then `npm install` at the root.
- pnpm: `pnpm add @radium-engine/react@workspace:*` (or `link:`).
- After changing package sources, rebuild them (`npm run build` in RadiumEngine):
  consumers read `dist/`, so a source change without a rebuild is invisible.

## 10. Styling and your own UI on top

The map fills its container and leaves your chrome alone:

```tsx
<div style={{ position: "relative", height: "100%" }}>
  <MapView />
  <div style={{ position: "absolute", top: 12, right: 12, zIndex: 500 }}>
    <button>My control</button>
  </div>
</div>
```

Notes:

- MapLibre's zoom/attribution controls sit in the corners; `zIndex` above 400 is safe for
  your own overlays.
- Objects and labels are DOM elements in 3D and Leaflet markers in 2D, so your CSS
  (fonts, colours) applies naturally. Give icons your own class through `model.html`
  (`<div class="my-aircraft">…</div>`).
- Both engines set `height: 100%; width: 100%` on their root element; pass
  `className`/`style` to `<MapView>` to override.

## 11. Migrating an existing map — checklist

1. Freeze one screen's worth of features (the layers you actually use).
2. Swap the provider/container for `<MapProvider>`/`<MapView>` plus a container height,
   and keep the old map until the new one shows the same imagery.
3. Convert markers to `<MapObject>` (moving) or `<Marker>` (static); polylines to
   `<Polyline>`, circles to `<Circle>`, areas to `<Polygon>`.
4. Reuse your icons as-is in `model.html` — no redrawing.
5. Replace hand-rolled smoothing with `motion={{ mode: "smooth" }}` and delete your
   interpolation code.
6. Replace hand-rolled track buffers with `<Track>` / `store.ensureTrack`.
7. Delete your tile cache, DEM decoding and prefetch loops: the pipeline and
   `ElevationService` replace them, and existing cache folders keep working when you
   reuse the folder names (`Terrarium`, `USGS_3DEP`, provider ids).
8. Only then consult [the migration table](./15-migration-radium.md) for a file-by-file
   mapping of a Radium-style codebase.

Next: [performance](./13-performance.md).

engine swap (`setMode`): camera, tracks and objects are preserved.
