# RadiumEngine — the complete guide

A **2D + 3D map and geo-object framework** for web, Electron and Tauri apps. One
declarative tree, two engines (Leaflet for 2D, MapLibre + three.js for 3D), one
offline tile/terrain cache.

```
┌──────────────── your application ────────────────┐
│  <MapProvider options>                           │  cache + pipeline + elevation
│    <MapView />          ← renders 2D or 3D        │  + scene store + camera
│    <MapObject pose6 …/> <Track/> <Polyline/> …    │  ← pure data, engine agnostic
│  </MapProvider>                                   │
└──────────────────────────────────────────────────┘
              │                        │
      Leaflet 2D engine        MapLibre + three.js 3D engine
              └────────┬───────────────┘
                 @radium-engine/core
        geo math · providers · tile pipeline · cache · DEM · motion · tracks
```

## Read in this order

| # | document | you will learn |
| --- | --- | --- |
| 1 | [01-installation.md](./01-installation.md) | install, peer dependencies, the two CSS imports, TS setup |
| 2 | [02-concepts.md](./02-concepts.md) | the mental model: poses, scene store, engines, camera |
| 3 | [03-configuration.md](./03-configuration.md) | every `<MapProvider>` option |
| 4 | [04-objects.md](./04-objects.md) | `<MapObject>`, `pose6`, motion modes, icons and models |
| 5 | [05-tracks.md](./05-tracks.md) | recorded tracks: windows, simplification, styles |
| 6 | [06-drawing.md](./06-drawing.md) | polylines, polygons, circles, labels, markers, drop lines |
| 7 | [07-providers.md](./07-providers.md) | imagery + terrain provider tables and custom URLs |
| 8 | [08-cache-offline.md](./08-cache-offline.md) | cache adapters, disk layout, prefetch, offline workflow |
| 9 | [09-terrain-elevation.md](./09-terrain-elevation.md) | DEM sources, smoothing, exaggeration, elevation API |
| 10 | [10-api-reference.md](./10-api-reference.md) | the complete API surface with signatures and defaults |
| 11 | [11-tauri-integration.md](./11-tauri-integration.md) | the optional Rust accelerator |
| 12 | [12-integration-recipes.md](./12-integration-recipes.md) | drop it into an existing project (React, Tauri, headless) |
| 13 | [13-performance.md](./13-performance.md) | frame budget, tuning, what is expensive and what is not |
| 14 | [14-troubleshooting.md](./14-troubleshooting.md) | everything that can go wrong, and why |
| 15 | [15-migration-radium.md](./15-migration-radium.md) | moving an existing Radium-style map onto the packages |
| 16 | [16-camera.md](./16-camera.md) | follow / chase / FPV cameras: modes, tuning, the maths, the checks |
| 17 | [17-settings.md](./17-settings.md) | persisted options without the "everything is back to the defaults" trap |
| 18 | [18-interaction.md](./18-interaction.md) | clicks, hovers, selection, measurement and undo |

## 60-second quick start

```bash
# from a checkout of this repository
npm install
npm run build
npm run playground        # http://localhost:5199
```

```bash
# or copy the starter template for your own app
cp -r templates/starter ../my-map-app
cd ../my-map-app && npm install && npm run dev
```

Minimal app (`src/App.tsx`):

```tsx
import { MapObject, MapProvider, MapView, useSimulatedTraffic } from "@radium-engine/react";

export function App() {
  const traffic = useSimulatedTraffic(true, 1);

  return (
    <MapProvider
      options={{
        mode: "3d",                       // "2d" | "3d" — switchable at runtime
        imagery: "ESRI.WorldImagery",
        terrain: { provider: "aws-terrarium", smoothing: 1 },
        exaggeration: 1.3,
        camera: { lat: 30.0444, lon: 31.2357, zoom: 13, pitch: 55 },
        cache: { kind: "auto", rootDir: "MyApp/tiles" },
      }}
    >
      <div style={{ position: "fixed", inset: 0 }}>
        <MapView />
      </div>

      {traffic.map((item) => (
        <MapObject key={item.id} id={item.id} pose6={item.pose6} motion={{ mode: "smooth" }} dropLine />
      ))}
    </MapProvider>
  );
}
```

And in your entry file, **once** (see [instantiation](./01-installation.md#the-two-css-imports)):

```ts
import "leaflet/dist/leaflet.css";          // for the 2D engine
import "maplibre-gl/dist/maplibre-gl.css";  // for the 3D engine
```

That is the whole hello-world: terrain, offline caching, smooth motion and a drop
line, in both modes.
