# RadiumEngine — status and continuation notes

_Last verified: typecheck clean on 4 workspaces, core + camera + settings checks pass
(`npm run check`), playground builds with Vite, packages bundle with esbuild +
declarations, react bundle contains 0 peer-CSS imports._

## This round: the camera system, and settings that stay put

Both come from the same place — an app that had already solved these problems and the
lessons it paid for — and both are now part of the engine rather than something every
project re-implements:

| what | where | why it exists |
| --- | --- | --- |
| **Cameras** (`free` / `follow` / `chase` / `fpv`) | `packages/core/src/camera/*`, `<FollowCamera>` in `packages/react`, `applyCameraFrame` for the 3D engine | a map camera can only be centred on the GROUND, so following an object's footprint lets it drift `alt/mpp` px (~490 px at zoom 18 for 100 m). The modes place an **eye** instead, and the framing is solved in closed form per frame |
| **Follow filter** (seeded, monotone, rate limited) | `camera/follow.ts` | a jittery feed shakes a copied camera; a filter that is not seeded glides in from (0, 0); a discrete alpha-beta overshoots 13 % |
| **FPV models** (`fixed` / `gimbal`) + lens | `camera/fpv.ts` | "which freedoms does the camera get" is a contract, and it regresses silently |
| **Persisted settings** | `packages/core/src/settings/*`, `useSettings` | the UI mounts before the document is read, so its first write saves the DEFAULTS over the user's file — every setting comes back at its default next launch, with nothing logged. The store holds early writes and replays them |
| **Interaction** (clicks, hover, selection) | `packages/core/src/interaction/*`, `interaction.tsx` in `packages/react`, `three/screenProjection.ts` | a map that cannot be clicked is a picture. One screen-space hit test serves both engines, so a 6 px line is 6 px wide to a mouse too, and what you can click always matches what is drawn (the same matrix, the same store) |
| **Tool utilities** | `packages/core/src/tools/*` | `pathLengthM`, `polygonAreaM2` (antimeridian-safe), `centroid`, `bearingAlong`, UI formatters, and `HistoryStore` (snapshot undo/redo with gesture coalescing) |
| **Packaging checks** | `scripts/check-package.mjs`, `.github/workflows/ci.yml` | the invariants this file used to state in prose: every `exports` entry exists, no *optional* peer is imported statically, no peer asset import, `core` depends on nothing, every package publishable in shape. CI runs typecheck + build + all five suites + the playground build |
| **Five check suites** | `check-core`, `check-camera`, `check-settings`, `check-interaction`, `check-package` | 36 + 45 + 27 + 73 + 30 assertions, all run by `npm run check` |

Playground: a Camera picker (free / follow / chase / FPV), an "object on screen %" slider
and an FPV mount-pitch slider — all **persisted**, so a reload comes back exactly as it was
left. `templates/starter` now ships with the camera and the persisted settings wired, which
is the shortest path to a new app.

## Documentation

`docs/` contains the full tutorial (19 files): index + quick start, installation, concepts,
configuration, objects/motion, tracks, drawing, providers, caching/offline,
terrain/elevation, API reference, Tauri integration, integration recipes, performance,
troubleshooting, migration table, **16-camera**, **17-settings** and **18-interaction**.
`README.md` links them.

**Fixed earlier:** the library no longer deep-imports `leaflet/dist/leaflet.css` or
`maplibre-gl/dist/maplibre-gl.css` (that import fails whenever the consumer's bundler
resolves leaflet elsewhere, which is what produced
`Failed to resolve import "leaflet/dist/leaflet.css" ... does not exist`). Consumers now
import both stylesheets once in their entry file — see
`docs/01-installation.md#the-two-css-imports` and `docs/14-troubleshooting.md`.
`scripts/build-package.mjs` also treats `leaflet/*`, `maplibre-gl/*`, `three/*`,
`react/*`, `geotiff/*` as external so a library never inlines a peer's assets.

## What exists and works

| area | state |
| --- | --- |
| `packages/core` (M1) | **complete** — geo (mercator matching MapLibre + great circle), 16 imagery providers, 4 terrain providers, 4 cache adapters (memory LRU / IndexedDB / Tauri fs / none + L1 wrapper), tiered tile pipeline (cache-first, in-flight dedup, GeoTIFF→terrarium + DEM smoothing transforms, `prefetch` with progress), `ElevationService` (true MSL **and** exaggeration-aware rendered ground), `PoseInterpolator` (jump/smooth/Catmull-Rom + extrapolation), `PoseStore`, `TrackRecorder` (+ time/length/point limits, Douglas-Peucker), `SceneStore` (objects, shapes, tracks), telemetry simulator, **`camera/`** (framing, FPV, follow filter, `CameraRig`), **`settings/`** (`SettingsStore` + adapters + merge) |
| `packages/react` (M2+M3) | **complete first cut** — `<MapProvider>`/`<MapView mode>`, shared camera + scene, Leaflet 2D engine (cached tile layer, objects, polylines, polygons, circles, labels, markers, tracks), MapLibre 3D engine (`radium://` protocol on the shared cache, raster-dem terrain + hillshade, fat-line layer for paths/tracks/circles/polygons/drop lines, DOM marker layer for objects/labels/markers with ground floor, polygon fill + extrusion), **`<FollowCamera>`** + `applyCameraFrame`, **`useSettings`** |
| `packages/tauri` (M6) | **written, not compiled** — Tauri 2 plugin crate (`prefetch_tiles`, `cache_stats`, `clear_cache`, `sample_elevation`, progress events, same `<folder>/<z>/<x>/<y>` layout) + optional JS wrapper with graceful degradation. Needs `cargo build` on a machine with the Rust toolchain. |
| `apps/playground` | **works** — mode switch, imagery picker, terrain picker + smoothing + exaggeration, motion mode, drop lines, 0–4 simulated aircraft with tracks, mission path with waypoint labels, extruded fence, geofence circle, prefetch + cache stats + ground height buttons, **camera mode / framing / FPV mount pickers, persisted settings + reset + adapter status** |
| `templates/starter` | **written, not installed** — Vite + React 19 + Tauri 2 app, `src-tauri` wires `tauri-plugin-radium-engine` from the local path, and `src/App.tsx` demonstrates persisted settings + a follow camera |

## Verified commands

```bash
npm install                 # root, workspaces (packages/*, apps/*)
npm run typecheck           # all 4 workspaces: clean
npm run check               # build core, run the harnesses: core + camera + settings
npm run build               # core + react + tauri (esbuild bundle + tsc declarations)
npm --workspace apps/playground run build   # vite build: OK
npm run playground          # dev server (http://localhost:5199)
```

## Known gaps / next steps (in order)

1. **Run the starter template once** — `cd templates/starter && npm install && npm run build`
   to confirm the out-of-tree path works (it is intentionally NOT a workspace).
2. **Compile the Rust plugin** — `npm --workspace @radium-engine/tauri run build:rust`
   (expect to fix small API drifts: `Emitter` import, `reqwest` feature set).
3. **3D models** — `three/modelsLayer.ts` is the remaining M4 piece: turn an icon into an
   extruded 3D shape and load GLB models, sized in screen pixels, so the playground can
   offer `model={{ kind: "glb", src }}`. Today `icon`, `icon3d` and `glb` all render through
   the DOM marker layer (correct position/altitude, flat look).
4. **Draw/edit modes** (click-to-place, drag handles, snapping) — the pieces exist
   (`HistoryStore`, `SelectionStore`, `pickAtScreen`); what is missing is a small active-tool
   controller in core plus a handle layer per engine (see `docs/18-interaction.md`).
5. **Lasso/box selection** and **clustering**: both are `hitCandidates` changes plus a
   screen-space polygon test / one candidate per cluster.
5. **Optional 2D-only extras** carried over from a real app: polygon edit handles,
   clustering.
6. **A sky layer for FPV** — mercator cannot show sky above the horizon
   (`HORIZON_PITCH_DEG`), so an FPV view is flat-topped today. The hook exists
   (`horizonScreenY` says where the horizon is); a quad with a gradient, drawn before the
   other layers, is the missing piece.
7. **Free look** (`F`-style, look around from a pinned eye): the maths is there
   (`eyePlacement` + `applyCameraFrame` accept a bearing/pitch/roll that is not the
   object's) — it needs a pointer/keyboard binding, not new geometry.
8. **M8 (optional)**: migrate Radium itself onto `@radium-engine/*` (last, on purpose).

## Architecture invariants (do not break these)

- `SceneStore` + `PoseStore` are the single source of truth; engines are renderers.
- `core` has **zero runtime dependencies**; `geotiff`, Tauri, React, Leaflet, MapLibre
  and three are optional peers, imported lazily — always with a **computed** specifier
  (`const specifier = "@tauri-apps/plugin-fs"; await import(/* @vite-ignore */ specifier)`),
  or a consumer that does not use them fails to build.
- Every tile goes through `TilePipeline` (cache-first). 2D and 3D share one cache.
- Sizes, line widths and clearances are expressed in **CSS pixels** and converted per
  frame; altitude uses MapLibre's mercator z (`alt / (earthCircumference · cos(lat))`),
  which is what keeps 3D objects glued to the terrain.
- Camera frames describe the **eye** or the **centre**; `applyCameraFrame` is the only
  place that talks to a map camera, and it prefers MapLibre's own inverse solver.
- A settings document is read before it is written: nothing mounts a writer before
  `SettingsStore.loaded` is true (`docs/17-settings.md`).
- Picking is a SCREEN-SPACE test through the engine is own projector, never a raycast against
  our own geometry: it is the only way 2D and 3D can agree, and it matches what is drawn.
- Only *optional* peers must stay dynamic; the engine peers (leaflet, maplibre-gl, three) are
  required by `@radium-engine/react` and may be static imports.
- Every claim that cannot be eyeballed gets a **check script** (`npm run check:camera`,
  `npm run check:settings`, …), and the script is run before the claim is made.
- Package builds go through `scripts/build-package.mjs` (esbuild bundle + `tsc`
  declarations) because a plain `tsc` emit produces extensionless ESM imports that
  Node cannot resolve.

## Cache layout (both engines, both languages)

```text
<cache root>/<folder>/<z>/<x>/<y>     folder ∈ {ESRI_WorldImagery, Terrarium,
                                       Terrarium_S1..3, USGS_3DEP, LocalDEM, ...}
```
