# RadiumEngine starter

A minimal app with everything wired: 2D + 3D maps, offline tiles, terrain, objects
with `pose6` telemetry, tracks and drawing primitives.

```bash
# 1. copy this folder out of the repository
cp -r templates/starter ../my-app && cd ../my-app

# 2. point the RadiumEngine packages at your local checkout (or a published version)
npm install
npm run dev          # browser
npm run desktop      # Tauri app (needs the Rust toolchain)
```

## What to edit

| file | what it does |
| --- | --- |
| `src/main.tsx` | imports the peer CSS (leaflet, maplibre), mounts React |
| `src/App.tsx` | the map configuration (`<MapProvider options>`) and the scene |
| `src-tauri/src/main.rs` | registers the optional Rust accelerator |
| `src-tauri/tauri.conf.json` | window title, size, bundle id |

`useSimulatedTraffic()` is a demo helper that produces real moving `pose6` values —
replace it with your own feed (a WebSocket, a state store, or
`store.setPose(id, pose)` from anywhere). The rule of thumb: **data goes into the scene
store** (`<MapObject>`, `<Track>`, `<Polyline>` …) and every engine renders it. Nothing
in `src/App.tsx` is engine specific, so switching between 2D and 3D never changes your
own code.

Full documentation: [../../docs/README.md](../../docs/README.md).
