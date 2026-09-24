# 15. Migrating a Radium-style codebase onto RadiumEngine

This is the mapping used when a proven map implementation (Radium's own, or anything
similar) is ported onto the packages. It is written for the last milestone on purpose:
the packages are already independently usable, so a migration is a code move, not a
rewrite.

## Concept mapping

| proven implementation concern | RadiumEngine equivalent |
| --- | --- |
| tile cache folder + protocol handler | `TilePipeline` + `createCache` (`@radium-engine/core/cache`) |
| `SmartTileLayer` (Leaflet, reads the cache) | `createCachedTileLayer({ pipeline, provider })` |
| MapLibre `radium://` tile protocol | `registerRadiumProtocol(pipeline)` + `radiumTileUrl()` |
| MapLibre style builder (basemap + DEM + hillshade) | `buildRadiumStyle({ imagery, terrain, pipeline })` |
| DEM tile decoding / `demTiles.ts` | `decodeElevationTile`, `demDecodeElevation`, `elevation.ensure()` |
| local DEM (`localDem.ts`) | `terrainSourceFor({ provider: "local-geotiff" })` + the GeoTIFF transform |
| ground height lookup (`ground.ts`) | `ElevationService.at()` (true MSL) / `.surface()` (as rendered) |
| terrain smoothing setting | `terrain.smoothing` (tiles are re-encoded once, cached separately) |
| ribbon / fat-line drawing (`ribbon.ts`) | `createLinesLayer` + `createFatLine`/`updateFatLine` |
| vehicle smoothing (`smoothVehicles.ts`) | `PoseInterpolator` (`motion: "smooth"`) |
| marker registry / DOM icons | `createMarkersLayer` + `buildMarkers` |
| vehicle 3D models (`VehicleModels3D`) | `ModelSpec` (`icon` today; `glb` via `three/modelsLayer.ts`, roadmap) |
| flight path / layers / interactions components | `<Polyline>`, `<Polygon>`, `<Circle>`, `<Track>`, `api.flyTo`, `api.fitBounds` |
| settings store holding provider ids | plain state + `imageryProviderFor()` / `terrainSourceFor()` |
| prefetch popup | `pipeline.prefetch(...)` with `onProgress`, or `prefetchTiles()` in Rust |
| cache inspector | `status()` / `pipeline.adapter.stats()` / `.clear(prefix)` |

## Settings mapping (typical)

| setting | where it goes |
| --- | --- |
| imagery provider id | `options.imagery` |
| custom imagery URL | `options.imagery = { url }` |
| terrain provider id | `options.terrain.provider` |
| terrain smoothing (0–3) | `options.terrain.smoothing` |
| vertical exaggeration | `options.exaggeration` |
| 2D / 3D | `options.mode` (or `api.setMode`) |
| camera pitch | `options.camera.pitch` / `defaultPitch` |
| max zoom clamp | provider `maxZoom` + `maxNativeZoom` |
| follow / auto-pan | `api.flyTo({ lat, lon })` on selection change |
| drop lines | per object `dropLine` or `options` wide default |
| show path / trail | `<Track>` per object (or `track: {}` on the object) |
| marker pixel size | `model.pixels` |
| cache root | `options.cache.rootDir` |

## Order of work that keeps the app working

1. **Core first, UI untouched.** Add `@radium-engine/core`, replace the tile cache and
   DEM helpers behind the existing interfaces. Note the cache folder names
   (`Terrarium`, `Terrarium_S1..3`, `USGS_3DEP`, provider ids) so existing caches keep
   working; nothing else changes.
2. **2D engine.** Swap the Leaflet map for `<MapProvider mode="2d">` + `<MapView>`,
   convert markers/lines/tracks to the scene components. The tile layer now reads the
   new cache.
3. **3D engine.** Swap the hand-rolled 3D view for `mode="3d"`. Delete the custom
   protocol, style builder, ground lookup and ribbon code — they are covered by
   `registerRadiumProtocol`, `buildRadiumStyle`, `ElevationService` and
   `createLinesLayer`.
4. **Smoothing and tracks.** Delete the custom interpolation and track buffers; use
   `motion` and `<Track>`. Compare a recorded flight with the old implementation — this
   is the step where you can *see* correctness.
5. **Prefetch and settings UI.** Replace the bespoke prefetch dialog with
   `pipeline.prefetch` / `prefetchTiles`, and the cache panel with `status()` +
   `adapter.clear()`.
6. **Optional Rust.** Move bulk prefetch and cache walking to the plugin.
7. **Delete dead code** only after each step has been verified on real data.

## Compatibility notes to watch for

| area | difference | action |
| --- | --- | --- |
| altitude | packages use **MSL**; some codebases store AGL or a terrain offset | convert once at ingest with `elevation.surface()` |
| icon size | packages use **CSS pixels**, not world meters | map old size values through `pixels` |
| colours | packages accept `#rrggbb` or `0xRRGGBB` | numeric colours are converted automatically |
| yaw unit | degrees, 0 = north, clockwise | convert radians/math-angle values |
| camera | `{ lat, lon, zoom, pitch, bearing }` | MapLibre uses `[lng, lat]` internally — the API hides it |
| track storage | `TrackRecorder` keeps `{lat, lon, alt, t}` and trims by policy | import historic logs with `track.push(point, timeMs)` so `durationMs` stays right |
| exact replay | `motion: "jump"` reproduces the feed verbatim | use it for analysis screens; `"smooth"` for live views |

## What you can delete when the migration is done

`tileCache.ts`, the MapLibre protocol registration and style builder, `demTiles.ts`,
`localDem.ts`, the ground-height cache, the ribbon/fat-line implementation, the vehicle
smoothing module, the marker registry, the flight-path layer and the prefetch popup —
roughly the whole map stack, replaced by two declarative components plus
`<MapObject>`/`<Track>`/`<Polyline>`.

Back to the [guide index](./README.md).
