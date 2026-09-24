# 14. Troubleshooting

## `Failed to resolve import "leaflet/dist/leaflet.css" ... does not exist`

**This was a real bug in the first build and is fixed.** The library used to deep-import
a peer dependency's CSS, which only resolves when your bundler can find `leaflet` — so
apps with leaflet hoisted elsewhere (pnpm strict linking, nested installs, monorepos)
failed to build.

The rule now: **the library never imports peer CSS. You import it, once, in your entry
file.**

```ts
import "leaflet/dist/leaflet.css";          // for mode="2d"
import "maplibre-gl/dist/maplibre-gl.css";  // for mode="3d"
```

If you still see the error:

1. Is `leaflet` actually installed? `npm ls leaflet` — it is a **peer** dependency, so
   `npm install leaflet` is required in *your* app.
2. Are you on the fixed build? In `node_modules/@radium-engine/react/dist/index.js`,
   search for `leaflet.css` — the correct bundle contains **zero** matches.
3. pnpm users: add `leaflet` and `maplibre-gl` to your own `dependencies`, not only
   transitively through RadiumEngine.
4. Stale lockfile: delete `node_modules` + the lockfile and reinstall.

## The map is invisible / zero height

Both engines fill their parent. Give the container an explicit size:

```tsx
<div style={{ position: "fixed", inset: 0 }}><MapView /></div>
// or
<div style={{ height: "70vh" }}><MapView /></div>
```

A flex/grid parent without `min-height: 0` also collapses to zero — set `min-height: 0`
on that grid/flex item.

## Tiles are blank in 2D but fine in 3D (or vice versa)

- Missing `leaflet/dist/leaflet.css` leaves Leaflet's tile pane unpositioned: it looks
  blank even though tiles load. Check the network tab — if requests succeed, it is CSS.
- Missing `maplibre-gl/dist/maplibre-gl.css` gives MapLibre's canvas no size. Same
  symptom, other engine.

## The 3D map is flat (no terrain)

| cause | check |
| --- | --- |
| `terrain: false` | the option |
| provider unreachable | network tab: the `radium://dem/…` request below it failing? |
| `aws-3dep` outside the US | 3DEP covers the United States only — use `aws-terrarium` |
| camera pitch is 0 | tilt the map, or set `camera.pitch` / `defaultPitch` |
| exaggeration is 0 | `exaggeration` must be ≥ 1 |
| a broken tile is cached | clear the folder (`Terrarium`) and retry |

## Terrain looks bumpy on flat ground

That is SRTM radar noise. Use `terrain: { provider: "aws-terrarium", smoothing: 1 }` (or
`2`). Smoothed tiles live in `Terrarium_S1` / `_S2`, so switching back is instant.

## Objects float above or sink into the ground

- `alt` is **MSL**. If your feed gives AGL, add the ground:
  `alt = agl + elevation.surface(lat, lon, exaggeration)`.
- Use the same `exaggeration` you configured when computing ground heights (that is what
  `elevation.surface` expects).
- Drop lines always end on the rendered ground. If a drop line looks right and the marker
  does not, the marker's `alt` is the value to fix.

## 3D object icons are enormous or tiny

Icon size is `model.pixels` / `model.widthPx` in **CSS pixels**, constant at every zoom.
If you previously sized icons in world meters, convert once — or use `pixels={64}` on
`<MapObject>`.

## Lines are 1 px wide, or change width when I tilt the camera

Both symptoms come from raw WebGL/Leaflet primitives. RadiumEngine uses screen-space fat
lines in 3D and `widthPx` in 2D. If you draw your own geometry through
`api.getEngineMap()` you are back to raw behaviour — use `createLinesLayer` instead.


## Nothing is cached / always online

| cause | fix |
| --- | --- |
| `cache: { enabled: false }` | remove it |
| private browsing | IndexedDB is unavailable; expect memory-only |
| Tauri without the fs plugin | `npm install @tauri-apps/plugin-fs`, register `.plugin(tauri_plugin_fs::init())`, add the capabilities |
| `rootDir` not writable | put it under the app data dir |
| `kind: "memory"` | switch to `"auto"` for persistence |

Verify with `await status()` — it reports the active adapter, entries and bytes.

## `radium://` requests fail in the 3D engine

The protocol is registered lazily when the map is created (`registerRadiumProtocol`). If
you build a MapLibre map yourself and reuse RadiumEngine's style, call it first:

```ts
import { registerRadiumProtocol } from "@radium-engine/react";
registerRadiumProtocol(pipeline);
```

MapLibre custom protocols must return an ArrayBuffer (`{ data: ArrayBuffer }`) — the
built-in registration does that for you.

## `Cannot find name 'window'` / SSR crash

Import the engines client-side only (`dynamic(..., { ssr: false })`, `"use client"`).
`@radium-engine/core` is safe to import anywhere.

## React StrictMode renders twice

Expected: effects mount, clean up, then mount again. Scene components are idempotent by
`id`, so nothing is duplicated. Doubled markers mean two components share one `id` — ids
must be unique per store.

## Type errors with `three` / `maplibre-gl`

Keep `"skipLibCheck": true` in your tsconfig (the `@types/three` and maplibre
declarations are large and occasionally conflict internally). RadiumEngine itself
compiles with `skipLibCheck`.

## `geotiff` not found (3DEP or local GeoTIFF terrain)

It is an **optional** peer, imported lazily:

```bash
npm install geotiff
```

Without it every other provider and feature still works; GeoTIFF tiles are passed through
unchanged and will not render as terrain.

## Playground / starter specifics

- **Port in use**: the playground is pinned to `5199` and the starter to `5183`
  (`strictPort`), so a conflict is reported instead of silently switching ports.
- **Tauri dev shows a blank window**: `devUrl` must match the Vite port, and
  `beforeDevCommand` must be `npm run dev`.
- **`cargo build` fails with linker OOM**: add `.cargo/config.toml` with
  `[build] jobs = 2`.
- **Icons missing in a Tauri bundle**: `src-tauri/icons/` must exist — generate a full set
  from one image with the `tauri icon` CLI.

## Reporting something properly

Include:

1. `mode`, provider ids, `terrain`/`exaggeration`, cache kind;
2. console output with `options.debug: true` (logs `hit`/`miss`/`download`/`stored` per
   tile key);
3. `await status()` (adapter, entries, bytes);
4. whether it reproduces in the playground (`npm run playground`).

Next: [migration table](./15-migration-radium.md).
