# 1. Installation

## Packages

| package | what it is | runtime dependencies |
| --- | --- | --- |
| `@radium-engine/core` | geo math, providers, tile pipeline, cache, DEM, motion, tracks, scene store | **none** |
| `@radium-engine/react` | `<MapProvider>`, `<MapView>`, scene components, both engines | `@radium-engine/core` + peers |
| `@radium-engine/tauri` | optional Rust accelerator (prefetch, cache stats, DEM sampling) | `@radium-engine/core` |

```bash
npm install @radium-engine/core @radium-engine/react
# 3D support (MapLibre + three) and 2D support (Leaflet) are peer dependencies:
npm install leaflet maplibre-gl three
npm install react react-dom
```

Installing from this repository (before publishing):

```bash
# inside the RadiumEngine checkout
npm install && npm run build

# in your app
npm install ../../RadiumEngine/packages/core ../../RadiumEngine/packages/react
# or with a relative path in package.json:  "@radium-engine/react": "file:../RadiumEngine/packages/react"
```

Vite, Next.js, Electron and Tauri all resolve the packages' ESM output directly
(`dist/index.js` + `dist/index.d.ts`), so no bundler configuration is required.

## Peer dependencies and what each one is for

| peer | needed for | notes |
| --- | --- | --- |
| `react` / `react-dom` (>=18) | `@radium-engine/react` | React 19 is what the playground and starter use |
| `leaflet` (>=1.9) | the 2D engine | only loaded when `mode === "2d"` |
| `maplibre-gl` (>=4) | the 3D engine | only loaded when `mode === "3d"` |
| `three` (>=0.160) | 3D overlays (fat lines) | only loaded by the 3D engine |
| `geotiff` (>=2, optional) | GeoTIFF **terrain tiles / local DEM** | imported lazily; without it everything else still works |
| `@tauri-apps/api` + `@tauri-apps/plugin-fs` (optional) | disk cache + Rust accelerator in a Tauri app | without them the cache falls back to IndexedDB |

None of these are required by `@radium-engine/core`. A headless Node script can use
the tile pipeline, the cache, the track recorder and the elevation service with no
UI dependencies at all.

## The two CSS imports

**RadiumEngine never imports a peer dependency's CSS for you.** A library that does
(`import "leaflet/dist/leaflet.css"` inside the library bundle) breaks the moment
your bundler resolves `leaflet` somewhere else — the classic
`Failed to resolve import "leaflet/dist/leaflet.css" ... does not exist`.

So import them once, in your own entry file:

```ts
// src/main.tsx  (or index.ts, main.js — wherever your app starts)
import "leaflet/dist/leaflet.css";          // required for mode="2d"
import "maplibre-gl/dist/maplibre-gl.css";  // required for mode="3d"

// then your own styles
import "./styles.css";

// and finally the app
import { createRoot } from "react-dom/client";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<App />);
```

If you only ever use one mode you may import only that stylesheet — but importing
both is what makes the runtime 2D ⇄ 3D switch look correct, and it costs ~85 kB of
CSS (17 kB gzipped).

Without these imports the map still works, but you will notice: Leaflet's tiles and
controls unpositioned, MapLibre's canvas without a size, and its controls unstyled.
That is the symptom to remember.

## TypeScript

The packages ship their own declarations; nothing to install.

```jsonc
// tsconfig.json of a Vite + React app
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,        // three/maplibre d.ts are heavy: keep this true
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

If you use a Node-flavoured tsconfig (`moduleResolution: "NodeNext"`), the packages
still typecheck, because their exported entry points are standard ESM with
declarations.

## Environment requirements

- **Browser**: any evergreen browser with WebGL2 for 3D (Edge/Chrome/Firefox/Safari 15+).
- **Node**: >= 20 for the build scripts (esbuild + tsc).
- **Tauri**: v2 (`tauri-build`, `tauri-plugin-fs`, plus the optional
  `tauri-plugin-radium-engine` crate from `packages/tauri/src-tauri`).

## The container must have a size

Both engines fill their parent element (`height: 100%; width: 100%`). A parent with
no height is the number one cause of "the map is invisible":

```tsx
// ✅ explicit height
<div style={{ position: "fixed", inset: 0 }}>
  <MapView />
</div>

// ✅ or via className
<div className="h-screen w-screen"><MapView className="h-full w-full" /></div>

// ❌ no height anywhere: the map renders into 0 px
<div><MapView /></div>
```

Next: [the mental model](./02-concepts.md).
