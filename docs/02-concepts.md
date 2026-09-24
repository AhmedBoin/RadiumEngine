# 2. Concepts — how RadiumEngine thinks

Understanding five ideas is enough to use everything else.

## 1. Everything that moves has a `pose6`

```ts
type Pose6 = {
  lat: number;   // degrees, WGS84
  lon: number;   // degrees
  alt: number;   // meters above mean sea level (MSL)
  roll: number;  // degrees, positive = right wing down
  pitch: number; // degrees, positive = nose up
  yaw: number;   // degrees, 0 = north, clockwise (compass heading)
};
```

Six numbers is what flight controllers, game engines, GPS/INS units and simulators
give you. You do not convert anything, and you never tell the map which engine is
running: `alt` is used in 3D (with the terrain), and ignored in 2D (a plan view) —
except `yaw`, which rotates the icon in both.

## 2. The scene store is the single source of truth

```
your data ──▶ SceneStore ──▶ engine (2D or 3D) ──▶ screen
   ▲              │
   └── subscribe ─┘
```

`<MapObject>`, `<Track>`, `<Polyline>` … write into one `SceneStore`. The engines
are *renderers* of that store and nothing else. Consequences worth knowing:

- Flipping 2D ⇄ 3D cannot lose state: both engines read the same objects, tracks,
  shapes, camera and cache.
- Motion is decided once (`jump` or `smooth`) and both engines move identically.
- You can drive the map from outside React entirely (see
  [headless usage](./12-integration-recipes.md#3-core-only-headless-no-react)) by
  calling `store.setPose(id, pose)` — handy when telemetry arrives in a worker or a
  WebSocket callback rather than in a render.

## 3. Motion is a policy, not a hack

Telemetry arrives in bursts (1–10 Hz); the screen renders at 60 Hz. `motion` decides
what happens in between:

| mode | behaviour | use it for |
| --- | --- | --- |
| `"jump"` | draw exactly the pose you received | replay, analysis, testing, precise screenshots |
| `"smooth"` | keep a short timestamped history, render it `lagMs` behind the newest pose, interpolate with Catmull-Rom and extrapolate with the last velocity | live telemetry, anything a human watches |

`smooth` is the default. It is what makes a low-rate feed look like a real aircraft
instead of a stepping marker, and it is the same code in both engines.

## 4. Two engines, one cache

```
                 ┌──────────────┐
 fetch ──────▶   │ TilePipeline │  cache-first · in-flight de-dup · transforms
                 └──────┬───────┘
                        │
              ┌─────────┴──────────┐
      Leaflet tile layer    MapLibre radium:// protocol
```

Both engines ask the pipeline for tiles, so panning in 2D warms the 3D map and
`prefetch()` makes both work offline. Every tile is downloaded **once**.

Terrain elevation goes through the same pipeline: `ElevationService` decodes the DEM
tiles the 3D engine is already using.

## 5. Screen-space correctness

Sizes, line widths and clearances are expressed in **CSS pixels** and converted per
frame, so nothing changes appearance when you zoom or tilt:

- line `widthPx` is width on screen, not world meters;
- icons and models are `pixels` tall at every zoom;
- drop lines, labels and markers keep a constant size in both engines;
- altitude uses MapLibre's mercator z (`alt / (earthCircumference · cos(lat))`),
  which is what glues objects to the rendered terrain at every latitude.

## Lifecycle at a glance

```tsx
<MapProvider options={...}>        // 1. creates cache + pipeline + elevation + store
  <MapView />                      // 2. mounts one engine (creates the map once)
  <MapObject/> <Track/> …          // 3. push data into the store, in any order
</MapProvider>
```

1. `MapProvider` resolves the imagery/terrain descriptors, builds the cache
   (`createCache`) and the `TilePipeline`, and creates the `ElevationService`.
2. `MapView` mounts the engine for `options.mode`. Changing the mode later unmounts
   one engine and mounts the other, reusing the same store, camera, cache and scene.
3. Scene components register/unregister themselves with the store as they mount and
   unmount. Nothing needs to be added in a particular order, and re-mounting a
   component is harmless (it is idempotent by `id`).

When the provider unmounts, the engines are disposed and the tile pipeline (with its
cache adapter) is released with it.

Next: [configuration](./03-configuration.md).
