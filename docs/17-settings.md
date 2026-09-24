# 17 · Persisted settings: the "everything is back to the defaults" trap

Almost every app stores *something* — the last imagery, the camera mode, a panel
preference — and almost every app gets the same thing subtly wrong: **the UI mounts
before the stored document has been read**, so it starts from the defaults, and the first
write safely stores those defaults over the user's file. Nothing errors, nothing logs, and
the user's settings are gone on the next launch.

`SettingsStore` exists so that cannot happen, and `useSettings` makes it one line:

```tsx
import { useSettings } from "@radium-engine/react";

type Ui = { mode: "2d" | "3d"; imagery: string; cameraMode: string; chasePitchDeg: number };

const DEFAULTS: Ui = { mode: "3d", imagery: "ESRI.WorldImagery", cameraMode: "free", chasePitchDeg: 45 };

export function App() {
  const { settings, loaded, status, set, reset } = useSettings<Ui>({
    defaults: DEFAULTS,
    key: "my-app.json",        // file inside Tauri, localStorage key in a browser
    debounceMs: 250,
  });

  /* wait for `loaded` before mounting anything that WRITES (a map, a camera, a form) */
  if (!loaded) return <div>loading…</div>;

  return (
    <MapProvider options={{ mode: settings.mode, imagery: settings.imagery }}>
      <MapView />
      <FollowCamera target="drone-1" mode={settings.cameraMode} tuning={{ chasePitchDeg: settings.chasePitchDeg }} />
      <button onClick={() => set({ mode: settings.mode === "2d" ? "3d" : "2d" })}>2D / 3D</button>
    </MapProvider>
  );
}
```

## The four rules it enforces

1. **Read before you write.** `loaded` is `false` until the document has been read (or the
   read has failed). A change made before that is applied to the in-memory state, held in
   a pending list and **replayed on top of the loaded document** — never written.
2. **Defaults first, always.** Loading is `deepMerge(defaults, stored)`: a field the file
   predates keeps its default, so shipping a new option never breaks an old file.
3. **A patch is partial.** `set({ camera: { zoom: 18 } })` merges key by key; arrays are
   values, not trees; `undefined` never overwrites.
4. **Writes are coalesced.** Dragging a slider schedules one write (`debounceMs`), so a
   settings screen costs a handful of writes, not one per frame.

## Adapters: where the document lives

| adapter | constructor | used by |
| --- | --- | --- |
| memory | `createMemoryAdapter()` | tests, SSR, "do not persist" |
| localStorage | `createLocalStorageAdapter(key)` | web / Electron |
| Tauri file | `createTauriSettingsAdapter({ file, base })` | Tauri apps (needs the fs plugin) |

`useSettings({ storage: "auto" })` (the default) picks for you: a **Tauri file** when
`__TAURI_INTERNALS__` exists, `localStorage` in a browser, memory in a worker/SSR. A
failure to read or write is never fatal: a corrupt document, a blocked storage or a missing
plugin degrades to "no stored settings" instead of an app that will not start.

The Tauri packages are loaded with computed specifiers, so nothing resolves them at build
time — an app that never touches Tauri bundles without them (same rule as the tile cache).

## Status and migrations

```ts
const { status } = useSettings({ defaults, key });
status; // { adapter: "tauri-fs(appData)", loaded: true, dirty: false, savedAt: 1699…, unknownKeys: [] }
```

* `unknownKeys` (with `strict: true`) lists keys the defaults do not know — a typo in a
  settings screen is otherwise invisible until a user complains that a switch does nothing.
* `migrate(stored, defaults)` renames or rescales fields from an older version, and its
  result is written back once, so the migration does not re-run on every start.
* `reset()` returns to the defaults and deletes the document; `flush()` writes immediately
  (a Save button, or before closing a window).

```ts
migrate: (stored) =>
  stored && "cameraZoom" in stored ? { camera: { zoom: stored.cameraZoom } } : null,
```

## Core only (no React)

```ts
import { SettingsStore, createLocalStorageAdapter } from "@radium-engine/core";

const store = new SettingsStore({ defaults, adapter: createLocalStorageAdapter("my-app.json") });
store.subscribe((settings) => console.log(settings));
await store.load();
store.set({ mode: "2d" });     // queued, then written
await store.flush();
```

## What `npm run check:settings` asserts

* a document written before a field existed still loads (defaults + file, merged);
* a change made **before** the load is not written, and is not lost either — it wins over
  the stored value afterwards, and exactly one write happens;
* `loaded` is `false` until the read finishes, and `true` even when the read throws (an app
  must not wait forever);
* three changes in one frame produce one write containing all of them;
* a migration runs before the merge and is persisted; unknown keys are reported;
* arrays are values, `undefined` never overwrites, and the defaults are never mutated.
