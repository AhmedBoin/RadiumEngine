# 4. Objects — `<MapObject>`

An object is anything that has a `pose6`: an aircraft, a rover, a person, a ship, a
camera, a waypoint marker. The same declaration draws it in 2D and in 3D.

```tsx
<MapObject
  id="uav-1"
  pose6={{ lat: 30.05, lon: 31.25, alt: 120, roll: 0, pitch: 2, yaw: 45 }}
  model={{ kind: "icon", html: AIRCRAFT_SVG, widthPx: 48, heightPx: 48 }}
  motion={{ mode: "smooth", lagMs: 280 }}
  dropLine
  track={{ maxSeconds: 120, style: { color: "#ffd400", widthPx: 6 } }}
/>
```

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `id` | `string` | **required** | stable identity; the key of everything (marker, track, motion buffer) |
| `pose6` | `Pose6` | **required** | where and in what attitude it is |
| `model` | `ModelSpec` | default pin | how it looks (see below) |
| `pixels` | `number` | `64` | icon size in CSS px (also usable inside `model`) |
| `motion` | `MotionOptions` | `{ mode: "smooth", lagMs: 280, maxExtrapolationMs: 2000 }` | how it travels between poses |
| `dropLine` | `boolean \| StrokeStyle` | `false` | red vertical line down to the ground (3D) |
| `track` | `{ maxSeconds?, maxMetres?, maxPoints?, simplifyM?, style? }` | off | record the history (see [tracks](./05-tracks.md)) |
| `visible` | `boolean` | `true` | hide without unmounting (keeps its track) |
| `color` | `string` | `#ff0000` | tint of the default pin |
| `zIndex` | `number` | `60` (3D) / `1000` (2D) | stacking order |
| `data` | `unknown` | – | your own payload; never rendered |

## Updating a pose (the hot path)

Push a new `pose6` on every message; React re-renders your component and the store
replaces the pose. The engine then animates according to `motion`.

```tsx
const [pose, setPose] = useState<Pose6>({ lat: 30, lon: 31, alt: 100, roll: 0, pitch: 0, yaw: 0 });

useEffect(() => {
  const socket = new WebSocket("wss://example/telemetry");
  socket.onmessage = (event) => {
    const f = JSON.parse(event.data);
    setPose({ lat: f.lat, lon: f.lon, alt: f.alt, roll: f.roll, pitch: f.pitch, yaw: f.yaw });
  };
  return () => socket.close();
}, []);

return <MapObject id="uav-1" pose6={pose} motion={{ mode: "smooth" }} />;
```

If your feed is faster than React should render (100 Hz+), do not go through state —
write to the store directly:

```tsx
const { store } = useMapEngine();

socket.onmessage = (event) => {
  const f = JSON.parse(event.data);
  store.setPose("uav-1", { lat: f.lat, lon: f.lon, alt: f.alt, roll: f.roll, pitch: f.pitch, yaw: f.yaw });
};  // ← no React render at all; the engine repaints on its own frame
```

## Models

```ts
type ModelSpec =
  | { kind: "icon";  html?: string; src?: string; widthPx?: number; heightPx?: number; anchorPx?: [number, number] }
  | { kind: "icon3d"; html?: string; icon?: string; pixels?: number }
  | { kind: "glb";   src: string; pixels?: number; yawOffsetDeg?: number };
```

| kind | 2D | 3D |
| --- | --- | --- |
| `icon` | inline SVG/HTML or an image URL | the same icon kept upright as a screen-facing billboard, rotated by `yaw`, never sinking into the terrain |
| `icon3d` | same | same (the extruded-mesh variant is the roadmap item in `RESUME.md`) |
| `glb` | default pin (a GLB has no 2D form) | three.js model normalised to `pixels` on screen (roadmap item) |

An `icon` is usually an SVG string you already have (callsign, tail number, drone
glyph). Inline SVG keeps the app offline-friendly and avoids extra requests:

```tsx
const AIRCRAFT = `<svg width="48" height="48" viewBox="0 0 48 48">
  <path d="M24 6 L28 22 L42 30 L42 34 L28 30 L27 38 L32 42 L32 45 L24 42 L16 45 L16 42 L21 38 L20 30 L6 34 L6 30 L20 22 Z"
        fill="#ff2d2d" stroke="#fff" stroke-width="1.4"/></svg>`;

<MapObject id="uav-1" pose6={pose} model={{ kind: "icon", html: AIRCRAFT, widthPx: 48, heightPx: 48 }} />
```


## The six numbers, and which engine uses them

| field | 2D (Leaflet) | 3D (MapLibre + three) |
| --- | --- | --- |
| `lat`, `lon` | marker position | object position |
| `alt` | ignored (plan view) | altitude **above mean sea level**; rendered where you say, but never below the ground of the DEM |
| `yaw` | rotates the icon | rotates the icon/billboard |
| `roll`, `pitch` | ignored | available for 3D models/billboards |

`alt` is MSL, not AGL. If you only know height above the ground, add the ground
height: `alt = agl + elevation.surface(lat, lon, exaggeration)` — see
[height above ground](./09-terrain-elevation.md#height-above-ground-agl).

## Motion tuning

```tsx
motion={{ mode: "smooth", lagMs: 280, maxExtrapolationMs: 2000 }}
```

| field | default | tuning advice |
| --- | --- | --- |
| `lagMs` | `280` | how far behind "now" the scene renders. Higher = smoother and more forgiving of jitter, but the object lags the true position. 150 ms feels snappy; 500 ms hides a lot of noise. A good starting point is 1.5× your update interval. |
| `maxExtrapolationMs` | `2000` | how long the last velocity keeps the object gliding when the feed stops. Lower it (300–500 ms) for a safety-critical display where a stale target must stop immediately. |

Switching modes at runtime is instant:

```tsx
<MapObject id="uav-1" pose6={pose} motion={{ mode: debugReplay ? "jump" : "smooth" }} />
```

## Drop lines

The vertical from the object down to the ground — the fastest way to read altitude
and ground track at a glance. Every drop line in the scene is drawn in **one** draw
call in 3D, so hundreds of objects stay cheap.

```tsx
<MapObject id="uav-1" pose6={pose} dropLine />                                  // red, 1.6 px
<MapObject id="uav-2" pose6={pose} dropLine={{ color: "#ffd400", widthPx: 2 }} />
<MapObject id="uav-3" pose6={pose} dropLine={false} />                           // none
```

The line ends exactly on the **rendered** ground (terrain exaggeration included), so
it never vanishes into a hill or floats above it.

## Removing objects

Unmounting the component removes the object from the engines. Its track stays in the
store, so history survives a re-render or a mode flip. To remove imperatively:

```tsx
const { store } = useMapEngine();
store.remove("uav-1");                 // marker gone, track kept
store.getTrack("uav-1")?.clear();      // and now the history is gone too
void store.snapshot().objects;         // everything currently on the map
```

## Several objects, one map

```tsx
{vehicles.map((vehicle) => (
  <MapObject
    key={vehicle.id}
    id={vehicle.id}
    pose6={vehicle.pose}
    model={{ kind: "icon", html: iconFor(vehicle.type), widthPx: 40, heightPx: 40 }}
    motion={{ mode: "smooth", lagMs: 250 }}
    dropLine={vehicle.id === selectedId}
    track={{ maxMetres: 5000, style: { color: colorFor(vehicle.id), widthPx: 5 } }}
  />
))}
```

Cost per object per frame is a few matrix operations; a few hundred objects with
tracks are comfortable on integrated GPUs. See
[performance](./13-performance.md#how-many-objects).
