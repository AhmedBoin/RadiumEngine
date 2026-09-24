# 3. Configuring the map — `<MapProvider options>`

```tsx
import { MapProvider } from "@radium-engine/react";

<MapProvider options={{ /* every field below is optional */ }}>
  <MapView />
</MapProvider>
```

| option | type | default | what it does |
| --- | --- | --- | --- |
| `mode` | `"2d" \| "3d"` | `"3d"` | which engine renders. Change it at runtime through `useMapApi().setMode()` |
| `imagery` | `string \| { url, subdomains?, attribution? }` | `ESRI.WorldImagery` | provider id from the [imagery table](./07-providers.md#imagery-providers) or a custom template |
| `terrain` | `{ provider?, customUrl?, smoothing? } \| false` | `{ provider: "aws-terrarium", smoothing: 0 }` | elevation source. `false` = flat 3D map, no DEM traffic at all |
| `exaggeration` | `number` | `1` | vertical exaggeration of the rendered terrain (and of everything placed on the ground) |
| `cache` | `{ kind?, rootDir?, baseDir?, maxBytes?, maxEntries?, database?, enabled? }` | `{ kind: "auto" }` | where tiles live; `enabled: false` disables caching and downloads everything live |
| `camera` | `{ lat, lon, zoom, pitch?, bearing? }` | `{ lat: 30.0444, lon: 31.2357, zoom: 12, pitch: 60 }` | the initial view |
| `defaultPitch` | `number` | `60` | pitch used when the user flips to 3D |
| `shareCamera` | `boolean` | `true` | keep the same camera when 2D ⇄ 3D flip |
| `attribution` | `boolean` | `true` | show the provider attribution control |
| `debug` | `boolean` | `false` | log tile cache hits/misses/downloads to the console |

## Camera

```ts
type CameraOptions = {
  lat: number;
  lon: number;
  zoom: number;      // 0 (world) … 22
  pitch?: number;    // 3D only, 0 … 85 degrees
  bearing?: number;  // 3D only, degrees clockwise from north
};
```

The camera is **shared** by both engines: `shareCamera` (default `true`) means 2D
opens exactly where 3D was, and vice versa. The engine writes the camera back into
the context on every `moveend`/`zoomend`, so `api.getCamera()` is always current and
you can persist it in your own settings store.

## Switching between 2D and 3D

```tsx
import { useMapApi, useMapMode } from "@radium-engine/react";

function ModeToggle() {
  const [mode, setMode] = useMapMode();   // reactive
  const api = useMapApi();                // imperative

  return <button onClick={() => setMode(mode === "2d" ? "3d" : "2d")}>
    Switch to {mode === "2d" ? "3D" : "2D"}
  </button>;
}
```

`useMapMode()` re-renders your component; `api.setMode()` does not. Both do the same
thing internally. During a flip the old engine is disposed and the new one is created
with the current camera, so the map does not jump.

## Imperative API

```ts
const api = useMapApi();

api.setMode("3d");
api.getMode();                               // "2d" | "3d"
api.flyTo({ lat: 30.05, lon: 31.25, zoom: 15, pitch: 65 }, { durationMs: 1200 });
api.fitBounds({ west: 31.1, south: 30.0, east: 31.4, north: 30.2 }, { paddingPx: 60 });
api.getCamera();                             // CameraOptions
api.getEngineMap();                          // the raw L.Map or maplibregl.Map
```

`getEngineMap()` is the escape hatch for features RadiumEngine does not wrap yet
(custom Leaflet layers, MapLibre sources, deck.gl interop, …). It returns `undefined`
until the engine has mounted, so guard it or call it from an effect.

## Reacting to the camera

```tsx
function CameraReadout() {
  const { camera } = useMapEngine();
  return <div>{camera.lat.toFixed(4)}, {camera.lon.toFixed(4)} · z{camera.zoom.toFixed(1)}</div>;
}
```

`useMapEngine()` also exposes everything expensive that the provider owns:

```ts
const {
  options,        // the merged options (mode, exaggeration, … resolved)
  store,          // the SceneStore
  pipeline,       // the TilePipeline (null while the cache is being created)
  elevation,      // the ElevationService (null when terrain === false)
  imagery,        // the resolved ImageryProvider
  terrain,        // the resolved DemSource (null when terrain === false)
  camera, setCamera,
  mode, setMode,
  api,
  ready,          // true once the engine mounted
  status,         // () => Promise<{ adapter, entries, bytes }>
} = useMapEngine();
```

## Status strip example

```tsx
function CacheStatus() {
  const { status, pipeline } = useMapEngine();
  const [text, setText] = useState("…");

  useEffect(() => {
    if (!pipeline) return setText("cache disabled");
    void status().then((s) =>
      setText(`${s.adapter} · ${s.entries} tiles · ${(s.bytes / 1048576).toFixed(1)} MB`),
    );
  }, [pipeline, status]);

  return <footer>{text}</footer>;
}
```

## Multiple maps on one page

Each `<MapProvider>` owns its own store, cache, pipeline and elevation service, so
two providers are two independent maps (different providers, different modes, even
different cache folders). Nothing is global except:
`registerRadiumProtocol()` (idempotent) and the Leaflet/MapLibre instance per map.

## Prop changes are honoured

`MapProvider` reacts to option changes:

| change | effect |
| --- | --- |
| `mode` | engine swap, camera kept |
| `imagery` | the 3D map is rebuilt (style) and the 2D tile layer swaps; the cache folder of the new provider is used automatically |
| `terrain` (provider/smoothing) | elevation service re-pointed; the 3D map is rebuilt with the new DEM source |
| `exaggeration` | terrain exaggeration updates live, no rebuild |
| `cache.*` | a new cache adapter + pipeline is created |
| `camera` | only the initial value; use the API afterwards |

Next: [objects and motion](./04-objects.md).
