// scripts/check-settings.mjs — persisted options, and the bug class they exist to avoid.
//
// Run `npm run build --workspace @radium-engine/core` first (the checks exercise the
// compiled output, same contract as `check-core.mjs`).
//
// The store exists because of a bug that is easy to hit and invisible: the UI (and the
// map) mount before the stored document has been read, so they start from the DEFAULTS —
// and any write in that window saves the defaults over the user file. The next start
// then shows every setting back at its default. Nothing errors, nothing logs. So the
// assertions below are:
//
//   1. a document written before a field existed still loads (defaults + file, merged);
//   2. a change made BEFORE the load is never written, and is not lost either — it is
//      replayed on top of the loaded document;
//   3. `loaded` is false until the read finishes (what an app waits for before mounting
//      anything that writes);
//   4. writes are coalesced, patches are partial, arrays are values and not trees.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "packages", "core", "dist", "index.js");

if (!existsSync(entry)) {
  console.error("Build the core package first: npm run build --workspace @radium-engine/core");
  process.exit(1);
}

const core = await import(`file://${entry.replace(/\\/g, "/")}`);

let failures = 0;
const eq = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
};
const ok = (label, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${condition || !detail ? "" : ` (${detail})`}`);
};
/* ── 1. merge semantics: defaults + file, partial patches ────────────── */
const defaults = {
  mode: "3d",
  imagery: "ESRI.WorldImagery",
  camera: { lat: 30, lon: 31, zoom: 12, pitch: 60 },
  layers: { models: true, paths: true, sky: true },
  bookmarks: [],
};

const oldDocument = { mode: "2d", camera: { zoom: 18 }, layers: { models: false }, bookmarks: ["a"] };
const merged = core.deepMerge(defaults, oldDocument);
eq("a field the file predates keeps its default", merged.imagery, "ESRI.WorldImagery");
eq("the file wins where it has a value", merged.mode, "2d");
eq("a partial branch merges key by key", merged.camera, { lat: 30, lon: 31, zoom: 18, pitch: 60 });
eq("a patch never touches its siblings", merged.layers, { models: false, paths: true, sky: true });
eq("arrays are values, not trees", merged.bookmarks, ["a"]);
eq("undefined never overwrites", core.deepMerge({ a: 1 }, { a: undefined }), { a: 1 });
eq("the defaults are not mutated", defaults.mode, "3d");
/* ── 2. the store never writes before it has read ────────────────────── */
{
  let saved = null;
  let saves = 0;
  const adapter = {
    id: "test",
    load: async () => ({ mode: "2d", camera: { zoom: 18, pitch: 30 }, layers: { sky: false } }),
    save: async (data) => {
      saved = JSON.parse(JSON.stringify(data));
      saves++;
    },
  };
  const store = new core.SettingsStore({ defaults, adapter, debounceMs: 0 });

  /* the window that causes the whole bug class: the app is alive, the file is not read */
  ok("loaded is false before the read", store.loaded === false);
  store.set({ camera: { zoom: 15 } });
  eq("a pre-load change updates the app immediately", store.snapshot.camera.zoom, 15);
  ok("a pre-load change is NOT written to the file", saves === 0, `saves=${saves}`);

  const loaded = await store.load();
  ok("loaded flips once the document has been read", store.loaded === true);
  eq(
    "the stored document wins over the default, the pre-load change wins over the document",
    loaded.camera,
    { lat: 30, lon: 31, zoom: 15, pitch: 30 },
  );
  eq("untouched fields keep the stored value", loaded.mode, "2d");
  eq("a field the file predates keeps its default", loaded.imagery, "ESRI.WorldImagery");
  eq("the replayed change was written once", saves, 1);
  eq("the file now holds the merged document", saved.camera.zoom, 15);
}
/* ── 3. coalesced writes, migrations, unknown keys, reset ────────────── */
{
  let saved = null;
  let saves = 0;
  const adapter = {
    id: "test",
    load: async () => ({ cameraZoom: 18 }),
    save: async (data) => {
      saved = JSON.parse(JSON.stringify(data));
      saves++;
    },
  };
  const store = new core.SettingsStore({
    defaults,
    adapter,
    debounceMs: 0,
    strict: true,
    /* an old document: bring one renamed field up to date before merging */
    migrate: (stored) => (stored && "cameraZoom" in stored ? { camera: { zoom: stored.cameraZoom } } : null),
  });
  const loaded = await store.load();
  eq("a migration runs before the merge", loaded.camera.zoom, 18);
  eq("the migrated document is what gets written", saved.camera.zoom, 18);

  /* a corrupt document must not break startup */
  const broken = new core.SettingsStore({
    defaults,
    adapter: { id: "broken", load: async () => { throw new Error("corrupt"); }, save: async () => {} },
  });
  const fallback = await broken.load();
  eq("a failed read falls back to the defaults", fallback, defaults);
  ok("a failed read still reports loaded (the app must not wait forever)", broken.loaded === true);

  /* several changes in one frame -> one write */
  saves = 0;
  store.set({ camera: { zoom: 16 } });
  store.set({ camera: { pitch: 45 } });
  store.set({ layers: { models: false } });
  await store.flush();
  eq("three changes in one frame are written once", saves, 1);
  eq("and all of them are in the write", [saved.camera.zoom, saved.camera.pitch, saved.layers.models], [16, 45, false]);
  ok("a save reports when it happened", typeof store.status.savedAt === "number");
  ok("the status names the adapter", store.status.adapter === "test");

  /* unknown keys are reported, so a typo in a settings UI is visible */
  const typo = new core.SettingsStore({
    defaults,
    adapter: { id: "typo", load: async () => ({ mode: "2d", camrea: { zoom: 18 } }), save: async () => {} },
    strict: true,
  });
  await typo.load();
  eq("unknown keys are reported in strict mode", typo.status.unknownKeys, ["camrea"]);

  /* reset goes back to the defaults and persists them */
  saves = 0;
  store.reset();
  await store.flush();
  eq("reset restores the defaults", store.snapshot.camera.zoom, 12);
  ok("reset persists", saves >= 1);
}

console.log(failures === 0 ? "\nSETTINGS CHECKS PASSED" : `\n${failures} SETTINGS ERROR(S)`);
process.exit(failures === 0 ? 0 : 1);
