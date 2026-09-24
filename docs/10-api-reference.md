# 10. API reference

Everything below is exported from `@radium-engine/react` (which re-exports all of
`@radium-engine/core`). Importing from `@radium-engine/core` directly is also supported,
and keeps a bundle free of React/Leaflet/MapLibre/three.

## Components

| component | props (required in **bold**) |
| --- | --- |
| `<MapProvider>` | **`options?: MapEngineOptions`**, **`children`** |
| `<MapView>` | `className?`, `style?` |
| `<MapObject>` | **`id`**, **`pose6`**, `model?`, `pixels?`, `motion?`, `dropLine?`, `track?`, `visible?`, `color?`, `zIndex?`, `data?` |
| `<Track>` | **`id`**, `maxSeconds?`, `maxMetres?`, `maxPoints?`, `simplifyM?`, `style?` |
| `<Polyline>` | **`id`**, **`points`**, `style?` |
| `<Polygon>` | **`id`**, **`points`**, `style?` |
| `<Circle>` | **`id`**, **`center`**, **`radiusM`**, `style?` |
| `<Label>` | **`id`**, **`pose`**, **`text`**, `style?` |
| `<Marker>` | **`id`**, **`pose`**, **`model`**, `rotationDeg?`, `style?` |
| `<DropLine>` | **`id`**, **`pose`**, `style?` |

## Hooks

| hook | returns |
| --- | --- |
| `useMapEngine()` | the whole context: `options, store, pipeline, elevation, imagery, terrain, camera, setCamera, mode, setMode, api, ready, setReady, status, version, bump` |
| `useMapApi()` | the imperative API: `setMode, getMode, flyTo, fitBounds, getCamera, getEngineMap` |
| `useMapMode()` | `[mode, setMode]` (reactive) |
| `useSceneStore()` | the `SceneStore` |
| `useElevationService()` | the `ElevationService` or `null` |
| `useScene()` | `{ objects, shapes, store, version }` — re-renders on scene changes |
| `useSimulatedTraffic(enabled?, count?, options?)` | `{ id, pose6 }[]` moving at a realistic rate (demo/dev helper) |

## Types

```ts
type LatLng = { lat: number; lon: number };
type LatLngAlt = { lat: number; lon: number; alt: number };
type Pose6 = { lat: number; lon: number; alt: number; roll: number; pitch: number; yaw: number };
type MapMode = "2d" | "3d";
type MotionMode = "jump" | "smooth";
type MotionOptions = { mode?: MotionMode; lagMs?: number; maxExtrapolationMs?: number };
type Color = string | number;
type StrokeStyle = { color: Color; widthPx?: number; opacity?: number; dashed?: boolean; dashPx?: number; gapPx?: number };
type FillStyle = { color: Color; opacity?: number; extrudeM?: number; baseM?: number };
type TrackStyle = StrokeStyle & { smoothing?: number; resampleM?: number };
type CameraOptions = { lat: number; lon: number; zoom: number; pitch?: number; bearing?: number };
type ModelSpec =
  | { kind: "icon"; html?: string; src?: string; widthPx?: number; heightPx?: number; anchorPx?: [number, number] }
  | { kind: "icon3d"; html?: string; icon?: string; pixels?: number }
  | { kind: "glb"; src: string; pixels?: number; yawOffsetDeg?: number };
```

## `MapEngineOptions`

```ts
type MapEngineOptions = {
  mode?: MapMode;
  imagery?: string | ({ url: string } & Partial<ImageryProvider>);
  terrain?: { provider?: string; customUrl?: string; smoothing?: number } | false;
  exaggeration?: number;
  cache?: { kind?: "auto" | "tauri-fs" | "indexeddb" | "memory" | "none";
            rootDir?: string; baseDir?: unknown; maxBytes?: number; maxEntries?: number;
            database?: string; enabled?: boolean };
  camera?: CameraOptions;
  defaultPitch?: number;
  shareCamera?: boolean;
  attribution?: boolean;
  debug?: boolean;
};
```


## Core classes

### `TilePipeline`

```ts
new TilePipeline({
  cache,                 // CacheAdapter (required)
  fetchTile?,            // (url, tile, source) => Promise<ArrayBuffer>
  transforms?,           // TileTransform[]  (pass defaultTileTransforms for DEM work)
  onEvent?,              // (event: TileEvent) => void
  concurrency?,          // default 6
});

pipeline.keyFor(source, tile)                  // "folder/z/x/y"
pipeline.urlFor(source, tile)                  // resolved URL
pipeline.has(source, tile)                     // Promise<boolean>
pipeline.get(source, tile, { skipCache? })     // Promise<ArrayBuffer>
pipeline.prefetch(source, tiles, options?)     // Promise<PrefetchProgress>
pipeline.stats()                               // Promise<CacheStats>
pipeline.adapter                               // the CacheAdapter
```

`TileEvent` = `{ type: "hit" | "miss" | "download" | "stored" | "error", key, url?, bytes?, error? }`.

### `SceneStore`

```ts
store.upsert(spec)                            // add or replace an object
store.setPose(id, pose, motion?)              // the hot path
store.remove(id); store.get(id); store.displayPose(id)
store.ensureTrack(id, options?); store.getTrack(id)
store.tracksList(); store.clearTracks()
store.setShape(shape); store.setShapes(shapes); store.removeShape(id); store.clearShapes()
store.snapshot()                              // { objects, shapes }
store.subscribe(listener)                     // () => void
store.poseStore                               // PoseStore (per-frame ticks)
store.active                                  // true while something is animating
```

### `PoseInterpolator` / `PoseStore`

```ts
const interpolator = new PoseInterpolator({ mode: "smooth", lagMs: 280, maxExtrapolationMs: 2000 });
interpolator.push(pose, timeMs?);
interpolator.sample(now?);   // Pose6 | null
interpolator.lastPose; interpolator.active;
interpolator.configure(options); interpolator.clear();

const poses = new PoseStore();
poses.ensure(id, options); poses.get(id); poses.remove(id); poses.clear();
poses.subscribe(() => { /* once per animation frame while something moves */ });
```

### `TrackRecorder`

```ts
const track = new TrackRecorder({ id, maxSeconds, maxMetres, maxPoints, simplifyM, style });
track.push({ lat, lon, alt }, timeMs?);
track.getPoints();          // TrackPoint[] = { lat, lon, alt, t }
track.count; track.lengthMeters; track.durationMs; track.style;
track.setOptions(partial); track.setStyle(style); track.clear();
```

### `ElevationService`

```ts
new ElevationService(pipeline, { source, sampleZoom?, maxTiles? });
elevation.at(lat, lon)                       // Promise<number | null>   (MSL, real)
elevation.surface(lat, lon, exaggeration?)   // number                    (as rendered)
elevation.cached(lat, lon)                   // number | undefined
elevation.ensure(points)                     // Promise<void>
elevation.setSource({ source }); elevation.invalidate();
elevation.subscribe(listener);
```


## Core functions

### Cache

```ts
createCache(config)                 // "auto" picks tauri-fs inside Tauri, else IndexedDB
createMemoryCache({ maxBytes?, maxEntries? })
createIndexedDbCache({ database?, store? })
createTauriFsCache({ rootDir?, baseDir?, createRoot? })
createNullCache(); withMemoryL1(adapter, { maxBytes?, maxEntries? })
isTauriFsAvailable()
folderForProvider(id); tileKey(folder, z, x, y); tilePath(...); parseTileKey(key)
```

`CacheAdapter` = `{ name, get, has, put, delete, clear(prefix?), stats(), keys?(prefix?) }`.

### Geo

```ts
mercatorAt(lat, lon, alt?)            // { x, y, z } normalised mercator (MapLibre-compatible)
latLngFromMercator(x, y, z?); mercatorZfromAltitude(alt, lat); altitudeFromMercatorZ(z, lat)
latToMercatorY(lat); mercatorYToLat(y); unitsPerPixel(zoom); metresPerPixel(lat, zoom)
lngLatToTile(lat, lon, z)             // { x, y, fx, fy }
tileBounds(z, x, y)                   // { west, east, north, south }
tilesForBounds(bounds, minZoom, maxZoom, limit?)
distanceMeters(a, b); bearingDeg(a, b); destinationPoint(origin, bearing, distanceM)
circle(center, radiusM, steps?); angleDeltaDeg(from, to); normaliseAngle(deg); clamp(v, min, max)
```

### Tiles

```ts
resolveTileUrl(template, z, x, y, subdomains?)   // {z} {x} {y} {s} {q} {-y}
toQuadKey(x, y, z); tileAt(lat, lon, z)
defaultTileTransforms                            // [geoTiffToTerrarium, demSmoothing]
geoTiffToTerrariumTransform; demSmoothingTransform
decodeGeoTiffTile(bytes); resizeNearest(heights, w, h, size?)
decodeElevationTile(bytes, encoding?); encodeTerrariumTile(heights, size?)
demDecodeElevation(encoding, r, g, b); demEncodeTerrarium(height)
smoothHeights(heights, passes, size?); clampElevation(value); isDemSource(source)
```

### Providers and telemetry

```ts
IMAGERY_PROVIDERS; DEFAULT_IMAGERY_PROVIDER; imageryProviderFor(id, customUrl?); imageryProviderGroups()
TERRAIN_PROVIDERS; DEFAULT_TERRAIN_PROVIDER; terrainSourceFor({ provider?, customUrl?, smoothing? })
isTerrainSourceLocal(source)
simulateTraffic({ count?, origin?, elapsedSeconds, baseAltM?, prefix? })   // { id, pose6 }[]
```

## Advanced (3D internals you can reuse)

```ts
buildRadiumStyle({ imagery, terrain, pipeline, background? })   // MapLibre style object
registerRadiumProtocol(pipeline)                                // idempotent; serves radium://tiles|dem
radiumTileUrl("tiles" | "dem", folder)                          // template with {z}/{x}/{y}
createLinesLayer(map, { lines, dropLines }, pipeline)           // fat lines (paths, tracks, drop lines)
createMarkersLayer(map, container, () => MarkerContent[])       // DOM markers, projected per frame
createCachedTileLayer({ pipeline, provider, tileSize?, zoomOffset?, maxNativeZoom?, opacity?, attribution? })
```

Next: [the Tauri accelerator](./11-tauri-integration.md).
