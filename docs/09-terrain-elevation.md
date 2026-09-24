# 9. Terrain and elevation

Two different questions, answered by two different methods — and knowing which is which
is the whole trick to a 3D map that looks right:

| question | method | returns |
| --- | --- | --- |
| "how high is the ground here, really?" | `elevation.at(lat, lon)` | meters **MSL**, the true DEM value |
| "where does the ground appear to be on screen?" | `elevation.surface(lat, lon, exaggeration)` | meters, **as rendered** (exaggeration applied) |

If you place something using the first number while the map draws with an exaggeration
of 1.3, it sinks into the hill. RadiumEngine uses the second internally for drop lines
and marker floors, which is why objects always sit exactly on the visible ground.

## Enabling terrain

```tsx
<MapProvider
  options={{
    terrain: { provider: "aws-terrarium", smoothing: 1 },   // or false for a flat map
    exaggeration: 1.3,                                      // 1 = real proportions
  }}
>
```

| option | default | meaning |
| --- | --- | --- |
| `terrain.provider` | `aws-terrarium` | see the [terrain provider table](./07-providers.md#terrain-providers) |
| `terrain.customUrl` | – | your own terrarium `{z}/{x}/{y}.png` server |
| `terrain.smoothing` | `0` | `0` raw, `1..3` increasingly smooth |
| `exaggeration` | `1` | vertical scale of the rendered terrain; `1.1–1.5` reads better on screen without lying about the shape |

### Why smoothing exists, and when to use it

SRTM-based DEMs (what `aws-terrarium` contains) are radar data: flat ground is a few
meters of noise, so a runway or a parking lot shows small bumps. Smoothing applies a
separable 1-2-1 binomial blur (`smoothHeights`) to the tile and caches the result:

| smoothing | effect | use |
| --- | --- | --- |
| `0` | raw data | analysis, accuracy above all |
| `1` | removes the speckle | the default for a calm, clean terrain |
| `2–3` | progressively smoother | hilly areas look cleaner, tiny features soften |

Smoothed tiles live in their own cache folder (`Terrarium_S1`…`_S3`), so moving the
slider never mixes data and never invalidates the raw tiles.

## The `ElevationService`

```tsx
const elevation = useElevationService();     // null when terrain === false
```

| method | signature | notes |
| --- | --- | --- |
| `at` | `(lat, lon) => Promise<number \| null>` | true MSL elevation; cache-first, downloads the DEM tile if needed; `null` when unavailable |
| `surface` | `(lat, lon, exaggeration?) => number` | **synchronous**, exaggeration-aware, `0` when unknown |
| `cached` | `(lat, lon) => number \| undefined` | what is already known, without awaiting |
| `ensure` | `(points: LatLng[]) => Promise<void>` | warm many points at once (one decode per DEM tile) |
| `setSource` | `(options) => void` | switch provider (clears decoded tiles) |
| `invalidate` | `() => void` | forget everything |
| `subscribe` | `(listener) => () => void` | notified when new elevations arrive |

```tsx
function GroundReadout() {
  const elevation = useElevationService();
  const { camera, options } = useMapEngine();
  const [text, setText] = useState("…");

  useEffect(() => {
    if (!elevation) return setText("no terrain");
    void elevation.at(camera.lat, camera.lon).then((value) =>
      setText(value == null ? "unknown" : `${value.toFixed(1)} m MSL`),
    );
  }, [elevation, camera.lat, camera.lon]);

  // what the map draws (exaggeration included)
  const rendered = elevation?.surface(camera.lat, camera.lon, options.exaggeration) ?? 0;

  return <p>ground {text} · rendered {rendered.toFixed(1)} m</p>;
}
```

### Height above ground (AGL)

Feeds usually report AGL for drones and MSL for aircraft. Convert once, on ingest:

```ts
const ground = elevation.surface(lat, lon, exaggeration);
const pose: Pose6 = { lat, lon, alt: aglHeight + ground, roll, pitch, yaw };
```

### Height of a whole route

```ts
await elevation.ensure(pathPoints);                        // one decode per DEM tile
const clearance = pose.alt - (elevation.surface(pose.lat, pose.lon, ex) || 0);
if (clearance < 50) warn("low altitude");
```

## How the DEM gets into the map

```
terrain source (terrarium PNG or 3DEP GeoTIFF)
        │
        ├── MapLibre: raster-dem + hillshade layers via the radium:// protocol
        │
        └── ElevationService: decoded 256×256 height grid, LRU (default 24 tiles)
                  │
                  └── per-point cache keyed to 5 decimals (≈ 1 m)
```

- The DEM tile is downloaded **once** and both consumers use it.
- Decoding uses an offscreen canvas; the decoded grid stays in an LRU so a moving
  aircraft does not re-decode its neighbourhood every frame.
- Hillshade is a genuinely expensive pass, so the engine hides it while the camera moves
  and restores it when the gesture ends — panning stays smooth on integrated GPUs.


## GeoTIFF terrain (USGS 3DEP) and local DEMs

`aws-3dep` serves GeoTIFF tiles that MapLibre cannot read. RadiumEngine converts each
tile to a terrarium PNG **once**, through the same pipeline that stores everything else:

```tsx
<MapProvider options={{ terrain: { provider: "aws-3dep", smoothing: 1 } }}>
```

This requires the optional `geotiff` peer (`npm i geotiff`). After the conversion the
cached tile is a normal elevation tile, so it keeps working offline, in 2D, and for
`ElevationService` — no runtime GeoTIFF dependency in the field.

For a fully offline area, the `local-geotiff` provider is the same transform pointed at
your own GeoTIFF pyramid (Copernicus GLO-30 worldwide, 3DEP for the US), with `smoothing`
applied on the way in.

## Turning terrain off

```tsx
<MapProvider options={{ terrain: false }}>
```

- no DEM requests at all (nothing downloaded, nothing cached),
- no `ElevationService` (`useElevationService()` returns `null`),
- drop lines and marker floors fall back to 0 (sea level),
- the fastest possible 3D mode — good for city-scale 2.5D views.

## Putting it together: a hill-aware overlay

```tsx
function TerrainOverlays({ path }: { path: LatLngAlt[] }) {
  const elevation = useElevationService();
  const { options } = useMapEngine();
  const [dragged, setDragged] = useState(path);

  // project a route onto the ground whenever it changes
  useEffect(() => {
    if (!elevation) return;
    void elevation.ensure(dragged).then(() =>
      setDragged((current) =>
        current.map((p) => ({
          ...p,
          alt: elevation.surface(p.lat, p.lon, options.exaggeration) + 2,
        })),
      ),
    );
  }, [dragged, elevation, options.exaggeration]);

  return <Polyline id="route" points={dragged} style={{ color: "#ffd400", widthPx: 4 }} />;
}
```

## Decoding elevation yourself

All the DEM primitives are exported from `@radium-engine/core`, so you can build your own
analysis (flight planning, line-of-sight, coverage) on the same data:

```ts
import {
  demDecodeElevation, demEncodeTerrarium, decodeElevationTile,
  smoothHeights, clampElevation, lngLatToTile,
} from "@radium-engine/core";

// one pixel of a raw terrarium tile
const height = demDecodeElevation("terrarium", r, g, b);

// a whole tile as a Float32Array(256*256)
const decoded = await decodeElevationTile(bytes);          // { heights, size }
const smoothed = smoothHeights(decoded.heights, 2, decoded.size);

// which tile/pixel a position falls into
const tile = lngLatToTile(lat, lon, 14);                   // { x, y, fx, fy }
```

Next: [the API reference](./10-api-reference.md).
