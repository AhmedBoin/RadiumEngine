# 5. Tracks — `<Track>`

A track is the recorded history of where an object has been. RadiumEngine records it
for you, limits it in time or distance, filters GPS jitter and simplifies it so it
stays a smooth line at any zoom.

```tsx
<MapObject id="uav-1" pose6={pose} track={{ maxSeconds: 120 }} />
```

There are two ways to configure a track — both are equivalent:

```tsx
// 1. inline with the object (most common)
<MapObject id="uav-1" pose6={pose} track={{ maxSeconds: 120, style: { color: "#ffd400", widthPx: 6 } }} />

// 2. as its own component, for a track whose style/limits change independently
<Track id="uav-1" maxSeconds={120} style={{ color: "#ffd400", widthPx: 6, smoothing: 1 }} />
```

| prop | default | meaning |
| --- | --- | --- |
| `maxSeconds` | off | keep only the last N seconds |
| `maxMetres` | off | keep only the last N meters of path |
| `maxPoints` | off | hard cap on stored points |
| `simplifyM` | off | Douglas-Peucker tolerance in meters (`0`/undefined = keep every point) |
| `style.color` | `#6a0090` | line colour (hex string or `0xRRGGBB`) |
| `style.widthPx` | 4 (2D) / 6 (3D) | **on-screen** width, constant while zooming |
| `style.opacity` | `0.95` | 0–1 |
| `style.dashed`, `dashPx`, `gapPx` | off | dashed tracks (2D; 3D uses solid fat lines) |
| `style.smoothing` | `1` | `0` = raw points, `1` = resample + 1-2-1 filter + spline (recommended) |
| `style.resampleM` | `2.5` | resampling spacing in meters |

You can combine limits; they are applied after every point:

```tsx
<Track id="uav-1" maxSeconds={300} maxMetres={20000} maxPoints={5000} simplifyM={0.6} />
```

## What the recorder actually does

```
push(pose) ──▶ [ time window ] ──▶ [ distance window ] ──▶ [ point cap ]
                                                     │
                                          getPoints() ──▶ [ resample ]
                                                          [ 1-2-1 denoise ]
                                                          [ Douglas-Peucker ]
                                                          [ Catmull-Rom spline ]
                                                            (in the 3D engine)
```

- Points are appended only when the position really changed (`1e-9` degrees ≈ 0.1 mm),
  so a stationary object does not grow its track.
- Altitude is kept per point, so the 3D track follows terrain and climb/descent.
- The length is maintained incrementally (no re-scan on every push).

## Reading track data

```tsx
const { store } = useMapEngine();
const track = store.getTrack("uav-1");

track?.count;          // stored points
track?.lengthMeters;   // path length
track?.durationMs;     // time span
track?.getPoints();    // TrackPoint[] = { lat, lon, alt, t } (simplified)
track?.clear();        // forget the history
store.tracksList();    // every track on the map
store.clearTracks();   // wipe all histories (objects stay)
```

A complete example — draw the track, show its statistics, and export it as GPX:

```tsx
function TrackStats({ id }: { id: string }) {
  const { store, version } = useMapEngine();   // `version` bumps on every change
  const track = store.getTrack(id);
  if (!track) return null;

  const exportGpx = () => {
    const points = track.getPoints().map(
      (p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.alt.toFixed(1)}</ele></trkpt>`,
    );
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${points.join("")}</trkseg></trk></gpx>`;
    const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    Object.assign(document.createElement("a"), { href: url, download: `${id}.gpx` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <span>{track.count} points · {(track.lengthMeters / 1000).toFixed(2)} km · {(track.durationMs / 60000).toFixed(1)} min</span>
      <button onClick={exportGpx}>Export GPX</button>
    </div>
  );
}
```

## Manually recording a track (no `<MapObject>`)

Tracks are independent of the visual object, which is what you want for a "greatest
hits" list, a mission log, or a path that must survive the aircraft being removed:

```tsx
const { store } = useMapEngine();

useEffect(() => {
  const track = store.ensureTrack("sortie-1", {
    maxSeconds: 1800,
    style: { color: "#00e5ff", widthPx: 5, smoothing: 1 },
  });
  const timer = setInterval(() => track.push({ lat: 30.05, lon: 31.25, alt: 120 }), 1000);
  return () => clearInterval(timer);
}, [store]);
```

`TrackRecorder.push(position, time?)` takes `{ lat, lon, alt }` and an optional
timestamp (defaults to `performance.now()`), so importing a recorded log uses the
original times and therefore a correct `durationMs`:

```tsx
const track = store.ensureTrack("replay-1", { maxPoints: 100000 });
for (const row of log) track.push({ lat: row.lat, lon: row.lon, alt: row.alt }, row.timeMs);
```

## Rendering details

- **2D**: a Leaflet polyline (canvas renderer) updated in place — no flicker when the
  last point moves.
- **3D**: the same screen-space fat lines as every other 3D line, with adaptive
  Catmull-Rom resampling and a 1-2-1 filter, so it looks smooth at zoom 18 and stays
  cheap at zoom 10. All tracks plus all paths live in a single three.js scene with one
  draw call per line.
- Tracks are drawn under markers and are not interactive by default.

Next: [drawing primitives](./06-drawing.md).
