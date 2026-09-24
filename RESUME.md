# RadiumEngine — status and continuation notes

_Last verified: typecheck clean on 4 workspaces, 36/36 core checks pass, playground
builds with Vite, packages bundle with esbuild + declarations, react bundle contains 0
peer-CSS imports._

## Documentation

`docs/` contains the full tutorial (16 files, ~100 KB): index + quick start,
installation, concepts, configuration, objects/motion, tracks, drawing, providers,
caching/offline, terrain/elevation, API reference, Tauri integration, integration
recipes, performance, troubleshooting, migration table. `README.md` links them.

**Fixed in this round:** the library no longer deep-imports `leaflet/dist/leaflet.css`
or `maplibre-gl/dist/maplibre-gl.css` (that import fails whenever the consumer's bundler
resolves leaflet elsewhere, which is what produced
`Failed to resolve import "leaflet/dist/leaflet.css" ... does not exist`). Consumers now
import both stylesheets once in their entry file — see
`docs/01-installation.md#the-two-css-imports` and `docs/14-troubleshooting.md`.
`scripts/build-package.mjs` also treats `leaflet/*`, `maplibre-gl/*`, `three/*`,
`react/*`, `geotiff/*` as external so a library never inlines a peer's assets.

## What exists and works

| area | state |
| --- | --- |
| `packages/core` (M1) | **complete** — geo (mercator matching MapLibre + great circle), 16 imagery providers, 4 terrain providers, 4 cache adapters (memory LRU / IndexedDB / Tauri fs / none + L1 wrapper), tiered tile pipeline (cache-first, in-flight dedup, GeoTIFF→terrarium + DEM smoothing transforms, `prefetch` with progress), `ElevationService` (true MSL **and** exaggeration-aware rendered ground), `PoseInterpolator` (jump/smooth/Catmull-Rom + extrapolation), `PoseStore`, `TrackRecorder` (+ time/length/point limits, Douglas-Peucker), `SceneStore` (objects, shapes, tracks), telemetry simulator |
| `packages/react` (M2+M3) | **complete first cut** — `<MapProvider>`/`<MapView mode>`, shared camera + scene, Leaflet 2D engine (cached tile layer, objects, polylines, polygons, circles, labels, markers, tracks), MapLibre 3D engine (`radium://` protocol on the shared cache, raster-dem terrain + hillshade, fat-line layer for paths/tracks/circles/polygons/drop lines, DOM marker layer for objects/labels/markers with ground floor, polygon fill + extrusion) |
| `packages/tauri` (M6) | **written, not compiled** — Tauri 2 plugin crate (`prefetch_tiles`, `cache_stats`, `clear_cache`, `sample_elevation`, progress events, same `<folder>/<z>/<x>/<y>` layout) + optional JS wrapper with graceful degradation. Needs `cargo build` on a machine with the Rust toolchain. |
| `apps/playground` | **works** — mode switch, imagery picker, terrain picker + smoothing + exaggeration, motion mode, drop lines, 0–4 simulated aircraft with tracks, mission path with waypoint labels, extruded fence, geofence circle, prefetch + cache stats + ground height buttons |
| `templates/starter` | **written, not installed** — Vite + React 19 + Tauri 2 app, `src-tauri` wires `tauri-plugin-radium-engine` from the local path |

## Verified commands

```bash
npm install                 # root, workspaces (packages/*, apps/*)
npm run typecheck           # all 4 workspaces: clean
npm run check               # builds core, runs scripts/check-core.mjs: 36/36 PASS
npm run build               # core + react + tauri (esbuild bundle + tsc declarations)
npm --workspace apps/playground run build   # vite build: OK
npm run playground          # dev server (http://localhost:5199)
```

## Known gaps / next steps (in order)

1. **Run the starter template once** — `cd templates/starter && npm install && npm run build`
   to confirm the out-of-tree path works (it is intentionally NOT a workspace).
2. **Compile the Rust plugin** — `npm --workspace @radium-engine/tauri run build:rust`
   (expect to fix small API drifts: `Emitter` import, `reqwest` feature set).
3. **3D models** — `three/modelsLayer.ts` is the remaining M4 piece: turn an icon
   into an extruded 3D shape and load GLB models, sized in screen pixels, so the
   playground can offer `model={{ kind: "glb", src }}`. Today `icon`, `icon3d` and
   `glb` all render through the DOM marker layer (correct position/altitude, flat look).
4. **Hover/click picking** in 3D (raycast against the fat lines, DOM events for markers).
5. **Optional 2D-only extras** carried over from Radium: polygon edit handles, clustering.
6. **M8 (optional)**: migrate Radium itself onto `@radium-engine/*` (last, on purpose).

## Architecture invariants (do not break these)

- `SceneStore` + `PoseStore` are the single source of truth; engines are renderers.
- `core` has **zero runtime dependencies**; `geotiff`, Tauri, React, Leaflet, MapLibre
  and three are optional peers, imported lazily.
- Every tile goes through `TilePipeline` (cache-first). 2D and 3D share one cache.
- Sizes, line widths and clearances are expressed in **CSS pixels** and converted per
  frame; altitude uses MapLibre's mercator z (`alt / (earthCircumference · cos(lat))`),
  which is what keeps 3D objects glued to the terrain.
- Package builds go through `scripts/build-package.mjs` (esbuild bundle + `tsc`
  declarations) because a plain `tsc` emit produces extensionless ESM imports that
  Node cannot resolve.

## Cache layout (both engines, both languages)

```text
<cache root>/<folder>/<z>/<x>/<y>     folder ∈ {ESRI_WorldImagery, Terrarium,
                                       Terrarium_S1..3, USGS_3DEP, LocalDEM, ...}
```
