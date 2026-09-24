# 6. Drawing — polylines, polygons, circles, labels, markers

All drawing primitives are declarative components that write into the same scene
store, so they appear in both engines with the geometry you wrote. Altitudes are
optional: a primitive without altitude sits on the ground in 3D.

```tsx
import { Circle, Label, Marker, Polygon, Polyline, DropLine } from "@radium-engine/react";
```

## `<Polyline>` — mission paths, borders, corridors

```tsx
const path: LatLngAlt[] = [
  { lat: 30.0444, lon: 31.2357, alt: 120 },
  { lat: 30.0485, lon: 31.2431, alt: 140 },
  { lat: 30.0521, lon: 31.2522, alt: 165 },
];

<Polyline id="mission" points={path} style={{ color: "#ffd400", widthPx: 4 }} />
```

| style | default | notes |
| --- | --- | --- |
| `color` | `#eeff00` | hex string or `0xRRGGBB` |
| `widthPx` | `3` | on-screen width, identical in 2D and 3D |
| `opacity` | `1` | 0–1 |
| `dashed`, `dashPx`, `gapPx` | off | 2D only (3D uses fat lines, always solid) |

`points` is `{ lat, lon, alt }[]`. In 3D the line follows the altitudes you give
(try `alt: 150` to float a corridor above the terrain); in 2D altitude is ignored.

## `<Polygon>` — fences, areas, extruded volumes

```tsx
<Polygon
  id="fence"
  points={[
    { lat: 30.052, lon: 31.238 },
    { lat: 30.059, lon: 31.244 },
    { lat: 30.062, lon: 31.258 },
    { lat: 30.054, lon: 31.263 },
    { lat: 30.047, lon: 31.252 },
  ]}
  style={{ color: "#22a34a", opacity: 0.18, widthPx: 3, extrudeM: 120 }}
/>
```

| style | default | notes |
| --- | --- | --- |
| `color` | `#22a34a` | outline **and** fill |
| `opacity` | `0.15` | fill opacity |
| `widthPx` | `3` | outline width |
| `extrudeM` | `0` | 3D: height of the extruded volume (a real geofence wall) |
| `baseM` | `0` | 3D: base of the extrusion (for stacked volumes) |

In 3D, polygons go through a GeoJSON source with a `fill` layer plus a
`fill-extrusion` layer, so the extrusion casts correct depth against the terrain. In
2D the same polygon is a Leaflet polygon. `0` opacity hides the fill and leaves the
outline.

## `<Circle>` — geofence rings, loiter radius, range

```tsx
<Circle id="loiter" center={{ lat: 30.0545, lon: 31.2505 }} radiusM={900}
        style={{ color: "#00e5ff", widthPx: 2.5, opacity: 0.08 }} />
```

`radiusM` is a real radius in meters (not pixels), so it scales correctly with zoom in
both engines. The 2D engine uses a geodesic circle; the 3D engine builds a 160-point
ring and splines it, so it stays a circle at any tilt.

## `<Label>` — text anchored to a position

```tsx
<Label id="wp-1" pose={{ lat: 30.0485, lon: 31.2431, alt: 140 }} text="WP1"
       style={{ background: "rgba(0,0,0,0.65)", color: "#fff", fontSizePx: 12 }} />
```

Labels are DOM elements in both engines: crisp text, real CSS, constant size, no
blurry textures. In 3D they are anchored at their altitude (and can be clamped to the
ground with `alt` = your ground value).

## `<Marker>` — a one-off icon at a position

```tsx
<Marker id="home" pose={{ lat: 30.0444, lon: 31.2357, alt: 0 }}
        model={{ kind: "icon", html: HOME_SVG, widthPx: 30, heightPx: 30 }}
        rotationDeg={0}
        style={{ zIndex: 45, interactive: true }} />
```

Use `<Marker>` for static points (home, land, a POI) and `<MapObject>` for anything
that moves — the difference is that `<MapObject>` owns a motion buffer, a track and a
drop line.

## `<DropLine>` — a vertical on its own

```tsx
<DropLine id="probe" pose={{ lat: 30.05, lon: 31.25, alt: 250 }} style={{ color: "#ff2b2b", widthPx: 2 }} />
```

Most of the time you use `dropLine` on a `<MapObject>`; this component is for a
single marker/probe you want to see against the ground without creating an object.

## Updating geometry

Every component re-registers its shape when its props change (signature-checked), so
live-edited missions work naturally:

```tsx
const [points, setPoints] = useState(path);

<Polyline id="mission" points={points} style={{ color: "#ffd400", widthPx: 4 }} />
<button onClick={() => setPoints((p) => [...p, nextWaypoint])}>Add waypoint</button>
```

Removing a primitive is unmounting it (or `store.removeShape(id)`). Replacing a whole
set at once is one call:

```tsx
const { store } = useMapEngine();
store.setShapes([
  { kind: "circle", id: "r1", center: { lat: 30, lon: 31 }, radiusM: 200 },
  { kind: "label", id: "l1", pose: { lat: 30, lon: 31, alt: 0 }, text: "R1" },
]);
store.clearShapes();   // remove them all
```

## Style resolution order

For shapes, the engine reads `shape.style` and falls back per field, so partial styles
are fine:

```tsx
<Circle id="c" center={c} radiusM={500} style={{ color: "#00e5ff" }} />   // widthPx/opacity default
```

Colours accept `"#rrggbb"`, `"rgba(...)"` or a number (`0x22a34a`) — numbers are
converted to hex for you.

Next: [providers](./07-providers.md).
