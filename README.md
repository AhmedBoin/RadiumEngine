# RadiumEngine

A reusable **2D + 3D map and geo-object framework** for Tauri, Electron and web
apps. One declarative tree, two engines (Leaflet for 2D, MapLibre + three.js for
3D), one offline tile/DEM cache — flip between 2D and 3D with a single prop.

```
packages/core      @radium-engine/core    geo math, providers, tile pipeline,
                                          cache adapters, DEM/elevation, motion, tracks
packages/react     @radium-engine/react   <MapProvider>, <MapView mode="2d|3d">,
                                          objects, tracks, polylines, polygons, circles
packages/tauri     @radium-engine/tauri   optional Rust plugin: parallel prefetch,
                                          cache management, GeoTIFF -> tiles
apps/playground                           live harness: every feature in 2D and 3D
templates/starter                         "start any new project from this"
```

## What you get out of the box

- **Objects with exactly six numbers** — `Pose6 { lat, lon, alt, roll, pitch, yaw }`
  — rendered as a flat icon in 2D and as a real 3D model in 3D, sized in screen
  pixels so it never looks wrong when the camera pitches.
- **Motion modes**: `motion: "jump"` (draw what you received) or
  `motion: "smooth"` (interpolation buffer + velocity extrapolation, the same
  technique that makes the 2D marker glide — ready for a future `"predict"`).
- **Tracks** with a time or length window (`maxSeconds`, `maxMetres`), point
  limits, Douglas-Peucker simplification, colour, on-screen thickness and
  smoothing.
- **Drawing**: polylines, polygons (with 3D extrusion), circles, labels, drop
  lines to the ground, plus the same primitives in both engines.
- **Providers**: OpenStreetMap (3), Google (4), Bing (3), ESRI (3), Carto (2) and
  any custom `{z}/{x}/{y}` template — plus free terrain: AWS Terrarium (global)
  and **USGS 3DEP bare earth** (US, ~10 m), a custom terrarium URL, or a local
  GeoTIFF (Copernicus GLO-30 / 3DEP) for fully offline terrain.
- **Cache**: pluggable adapters (memory LRU, **Tauri fs**, IndexedDB, none) with
  a configurable root folder, tile transforms (GeoTIFF → terrarium, terrain
  smoothing), `prefetch()` for offline areas and cache stats/clear for settings
  UIs. Every tile is fetched once.
- **Elevation service**: real MSL elevation *and* the elevation as rendered
  (terrain-exaggeration aware) so icons, drop lines and objects sit exactly on the
  visible ground, never under it.

## Quick start (React + Vite)

Import the peer styles **once in your entry file** — RadiumEngine deliberately never
deep-imports a dependency's CSS, so this is your one required line (see
[why](docs/01-installation.md#the-two-css-imports)):

```ts
// src/main.tsx
import "leaflet/dist/leaflet.css";          // for the 2D engine
import "maplibre-gl/dist/maplibre-gl.css";  // for the 3D engine
```

```tsx
import { MapProvider, MapView, MapObject, Polyline, Track } from "@radium-engine/react";

export function App() {
  return (
    <MapProvider
      options={{
        mode: "3d",                                  // "2d" | "3d"
        imagery: "ESRI.WorldImagery",
        terrain: { provider: "aws-terrarium", smoothing: 1, },
        exaggeration: 1.3,
        cache: { kind: "auto", rootDir: "MyApp/tiles" },
        camera: { lat: 30.0444, lon: 31.2357, zoom: 12, pitch: 60 },
      }}
    >
      <div style={{ position: "fixed", inset: 0 }}>
        <MapView />
      </div>
    </MapProvider>
  );
}
```

📘 **Full tutorial:** [docs/README.md](docs/README.md) — installation, every option,
objects and motion, tracks, drawing, providers, offline caching, terrain, the Tauri
accelerator, integration recipes, performance and troubleshooting.

## Core only (no React)

```ts
import {
  createCache, TilePipeline, defaultTileTransforms, terrainSourceFor,
  ElevationService, SceneStore, PoseInterpolator,
} from "@radium-engine/core";

const cache = await createCache({ rootDir: "MyApp/tiles" });
const pipeline = new TilePipeline({ cache, transforms: defaultTileTransforms });
const dem = terrainSourceFor({ provider: "aws-3dep", smoothing: 2 });
const elevation = new ElevationService(pipeline, { source: dem });

await pipeline.prefetch(dem, tiles, { onProgress: (p) => console.log(p.done, "/", p.total) });
const ground = await elevation.at(30.0444, 31.2357);   // meters MSL, cached
```

## Documentation

| document | contents |
| --- | --- |
| [docs/README.md](docs/README.md) | **start here** — index and 60-second quick start |
| [docs/01-installation.md](docs/01-installation.md) | install, peers, the CSS imports, tsconfig, container sizing |
| [docs/02-concepts.md](docs/02-concepts.md) | pose6, scene store, engines, camera, lifecycle |
| [docs/03-configuration.md](docs/03-configuration.md) | every `<MapProvider>` option + the imperative API |
| [docs/04-objects.md](docs/04-objects.md) | `<MapObject>`, motion tuning, models, drop lines |
| [docs/05-tracks.md](docs/05-tracks.md) | recording, windows, simplification, export |
| [docs/06-drawing.md](docs/06-drawing.md) | polylines, polygons, circles, labels, markers |
| [docs/07-providers.md](docs/07-providers.md) | imagery + terrain tables, custom URLs |
| [docs/08-cache-offline.md](docs/08-cache-offline.md) | adapters, disk layout, prefetch, offline workflow |
| [docs/09-terrain-elevation.md](docs/09-terrain-elevation.md) | DEM sources, smoothing, AGL/MSL, elevation API |
| [docs/10-api-reference.md](docs/10-api-reference.md) | the complete API surface |
| [docs/11-tauri-integration.md](docs/11-tauri-integration.md) | the optional Rust accelerator |
| [docs/12-integration-recipes.md](docs/12-integration-recipes.md) | add it to an existing app (React, Tauri, headless, SSR, Electron) |
| [docs/13-performance.md](docs/13-performance.md) | frame budget, tuning, object limits |
| [docs/14-troubleshooting.md](docs/14-troubleshooting.md) | every failure mode and its cause |
| [docs/15-migration-radium.md](docs/15-migration-radium.md) | porting a proven map stack onto the packages |

## Scripts

```bash
npm run build       # build every package (esbuild + tsc declarations)
npm run check       # build core, then run the assertion harness
npm run typecheck   # strict type check of every package
npm run playground  # live 2D/3D demo app
```

## Design rules

1. **One source of truth** (`SceneStore` + `PoseStore`): engines are thin
   renderers, so 2D and 3D can never drift apart.
2. **Cache first, always**: no tile is downloaded twice; offline is the default
   state, not a special mode.
3. **No hidden coupling**: `core` has zero runtime dependencies; `geotiff`, Tauri
   packages, React, Leaflet, MapLibre and three are optional peers loaded lazily.
4. **Screen-space correctness**: widths, icon sizes and clearances are expressed
   in CSS pixels and converted per frame, so zoom and camera pitch never change
   how big something looks.
