// scripts/check-interaction.mjs — picking, selection and the tool utilities, verified.
//
// Run `npm run build --workspace @radium-engine/core` first (the checks exercise the
// compiled output, same contract as `check-core.mjs`).
//
// Why these assertions matter: picking is the one feature whose bugs are invisible in a
// screenshot. A hit area that is 10 px too small "works" until a user cannot click a thin
// line at zoom 12, and a circle whose radius is converted with a metres-per-pixel guess is
// wrong at every latitude but the one it was tested at. So the projector is a fake with a
// KNOWN scale, and hit areas, tolerances, tie-breaks, hover bookkeeping and undo/redo are
// all asserted numerically.
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
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` (got ${JSON.stringify(actual)})`}`);
};
const near = (label, actual, expected, tolerance = 1e-6) => {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` (got ${actual}, want ~${expected})`}`);
};
const ok = (label, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${condition || !detail ? "" : ` (${detail})`}`);
};

/* A projector with a KNOWN scale: 10000 px per degree, so 1 m is 0.0898 px at this
   latitude. Altitude is ignored on purpose (the flat case first). */
const SCALE = 10000;
const project = (lat, lon) => ({ x: (lon - 31.2) * SCALE, y: (30.1 - lat) * SCALE });
const pxPerDegreeLat = SCALE;
const metresPerDegreeLat = 111320;
const pxPerMetre = pxPerDegreeLat / metresPerDegreeLat;/* ── 1. the primitives ───────────────────────────────────────────────── */
{
  near("distance to a segment is perpendicular", core.distanceToSegmentPx({ x: 5, y: 6 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 6, 1e-9);
  near("…and falls back to the endpoint beyond the end", core.distanceToSegmentPx({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5, 1e-9);
  near("a degenerate segment is a point", core.distanceToSegmentPx({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5, 1e-9);

  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  ok("inside a ring is inside", core.pointInPolygonPx({ x: 5, y: 5 }, square));
  ok("outside a ring is outside", !core.pointInPolygonPx({ x: 15, y: 5 }, square));
}

/* ── 2. markers, labels, objects: a disc of pixels ───────────────────── */
{
  const marker = { id: "m", kind: "marker", center: { lat: 30.05, lon: 31.25, alt: 0 }, radiusPx: 12 };
  const at = (dLat, dLon) => ({ x: (31.25 + dLon - 31.2) * SCALE, y: (30.1 - (30.05 + dLat)) * SCALE });

  const centre = core.pickAtScreen({ point: at(0, 0), candidates: [marker], project });
  eq("the centre of a marker is a hit", { id: centre.id, kind: centre.kind, distancePx: centre.distancePx }, { id: "m", kind: "marker", distancePx: 0 });
  near("the hit carries the marker position", centre.lat, 30.05, 1e-9);

  const inside = core.pickAtScreen({ point: at(0, 11 / SCALE), candidates: [marker], project });
  ok("11 px from the centre is still inside a 12 px disc", inside !== null, "null");

  const outside = core.pickAtScreen({ point: at(0, 13 / SCALE), candidates: [marker], project, tolerancePx: 0 });
  eq("13 px from the centre is a miss", outside, null);

  const forgiving = core.pickAtScreen({ point: at(0, 13 / SCALE), candidates: [marker], project, tolerancePx: 4 });
  ok("tolerance widens the hit area (touch UIs)", forgiving !== null && Math.abs(forgiving.distancePx - 1) < 0.01);
}

/* ── 3. lines: a capsule of the DRAWN width ──────────────────────────── */
{
  const line = {
    id: "p",
    kind: "polyline",
    points: [
      { lat: 30.05, lon: 31.24, alt: 100 },
      { lat: 30.05, lon: 31.26, alt: 300 },
    ],
    widthPx: 4,
  };
  const at = (dLat, dLon) => ({ x: (31.25 + dLon - 31.2) * SCALE, y: (30.1 - (30.05 + dLat)) * SCALE });

  near("1 px off a 4 px line is inside it", core.pickAtScreen({ point: at(1 / SCALE, 0), candidates: [line], project }).distancePx, 0);
  near("3 px off it is 1 px outside", core.pickAtScreen({ point: at(3 / SCALE, 0), candidates: [line], project }).distancePx, 1, 0.01);
  eq("6 px off it is a miss", core.pickAtScreen({ point: at(6 / SCALE, 0), candidates: [line], project, tolerancePx: 0 }), null);

  /* the position ON the line is interpolated, not the nearest vertex */
  const middle = core.pickAtScreen({ point: at(0, 0), candidates: [line], project });
  near("a mid-line hit interpolates the altitude", middle.altM, 200, 1);
  near("…and the longitude", middle.lon, 31.25, 1e-6);
}
/* ── 4. circles: the radius is METRES, converted through the projector ── */
{
  const circle = { id: "c", kind: "circle", center: { lat: 30.05, lon: 31.25, alt: 0 }, radiusM: 100 };
  const at = (dLat, dLon) => ({ x: (31.25 + dLon - 31.2) * SCALE, y: (30.1 - (30.05 + dLat)) * SCALE });
  /* The rim is offset EAST, where a degree of longitude is cos(lat) shorter, so the pixel
     radius is a little larger than the north-south scale suggests. A real Web Mercator map
     makes the two identical (it is conformal); this fake projector is equirectangular on
     purpose, so the assertion follows the projector. */
  const pxPerMetreEast = SCALE / (metresPerDegreeLat * Math.cos((30.05 * Math.PI) / 180));
  const radiusPxExpected = 100 * pxPerMetreEast;

  near("a 100 m circle is ~10.37 px here", radiusPxExpected, 10.37, 0.05);
  ok("half way out is inside", core.pickAtScreen({ point: at(radiusPxExpected / 2 / SCALE, 0), candidates: [circle], project }) !== null);
  eq("just outside the rim is a miss", core.pickAtScreen({ point: at(20 / SCALE, 0), candidates: [circle], project, tolerancePx: 0 }), null);
  ok(
    "the rim itself is the boundary, not a guess at metres-per-pixel",
    core.pickAtScreen({ point: at(11 / SCALE, 0), candidates: [circle], project, tolerancePx: 0 }) === null &&
      core.pickAtScreen({ point: at(10 / SCALE, 0), candidates: [circle], project, tolerancePx: 0 }) !== null,
  );
}

/* ── 5. polygons: inside is a hit, outside is the edge distance ──────── */
{
  const polygon = {
    id: "g",
    kind: "polygon",
    polygon: [
      { lat: 30.04, lon: 31.24 },
      { lat: 30.06, lon: 31.24 },
      { lat: 30.06, lon: 31.26 },
      { lat: 30.04, lon: 31.26 },
    ],
    widthPx: 2,
  };
  const at = (lat, lon) => ({ x: (lon - 31.2) * SCALE, y: (30.1 - lat) * SCALE });

  const inside = core.pickAtScreen({ point: at(30.05, 31.25), candidates: [polygon], project });
  near("the middle of a polygon is a 0 px hit", inside.distancePx, 0);
  eq("well outside is a miss", core.pickAtScreen({ point: at(30.08, 31.25), candidates: [polygon], project }), null);
  ok(
    "just outside the outline still hits with tolerance",
    core.pickAtScreen({ point: at(30.0601, 31.25), candidates: [polygon], project, tolerancePx: 4 }) !== null,
  );
}

/* ── 6. tie-breaks: distance first, then what is drawn on top ────────── */
{
  const marker = { id: "marker", kind: "marker", center: { lat: 30.05, lon: 31.25, alt: 0 }, radiusPx: 12 };
  const polygon = {
    id: "polygon",
    kind: "polygon",
    polygon: [
      { lat: 30.04, lon: 31.24 },
      { lat: 30.06, lon: 31.24 },
      { lat: 30.06, lon: 31.26 },
      { lat: 30.04, lon: 31.26 },
    ],
  };
  const at = (lat, lon) => ({ x: (lon - 31.2) * SCALE, y: (30.1 - lat) * SCALE });

  /* both are a 0 px hit at the marker centre: the marker wins */
  const best = core.pickAtScreen({ point: at(30.05, 31.25), candidates: [polygon, marker], project });
  eq("a marker wins over the fill under it", best.id, "marker");

  /* a far marker loses to a nearer line */
  const line = { id: "line", kind: "polyline", points: [{ lat: 30.052, lon: 31.25, alt: 0 }, { lat: 30.048, lon: 31.25, alt: 0 }], widthPx: 2 };
  const ranked = core.pickAllAtScreen({ point: at(30.052, 31.25), candidates: [marker, line], project, tolerancePx: 12 });
  eq("the nearest item ranks first", ranked.map((hit) => hit.id), ["line", "marker"]);
  ok("all hits come back, best first", ranked.length === 2);
}
/* ── 7. candidates come from the store both engines already draw ─────── */
{
  const store = new core.SceneStore();
  store.setPose("uav-1", { lat: 30.05, lon: 31.25, alt: 300, roll: 0, pitch: 0, yaw: 45 }, { mode: "jump" });
  store.setShape({ kind: "polyline", id: "path", points: [{ lat: 30.05, lon: 31.24, alt: 100 }, { lat: 30.05, lon: 31.26, alt: 120 }] });
  store.setShape({
    kind: "polygon",
    id: "fence",
    points: [{ lat: 30.04, lon: 31.24 }, { lat: 30.06, lon: 31.24 }, { lat: 30.06, lon: 31.26 }],
  });
  store.setShape({ kind: "circle", id: "ring", center: { lat: 30.05, lon: 31.25 }, radiusM: 300 });
  store.setShape({ kind: "marker", id: "home", pose: { lat: 30.051, lon: 31.251, alt: 0 }, model: { kind: "icon", html: "<b>x</b>" } });
  store.setShape({ kind: "label", id: "wp-1", pose: { lat: 30.052, lon: 31.252, alt: 50 }, text: "WP1" });
  store.setShape({ kind: "dropLine", id: "drop", pose: { lat: 30.05, lon: 31.25, alt: 300, roll: 0, pitch: 0, yaw: 0 } });

  const track = store.ensureTrack("uav-1", { maxPoints: 100 });
  track.push({ lat: 30.05, lon: 31.24, alt: 100 });
  track.push({ lat: 30.05, lon: 31.25, alt: 110 });
  const lonely = new core.TrackRecorder({ id: "lonely" });
  lonely.push({ lat: 30.05, lon: 31.25, alt: 0 });

  const candidates = core.hitCandidates(store.snapshot(), [...store.tracksList(), lonely]);
  const byId = Object.fromEntries(candidates.map((entry) => [entry.id, entry]));
  eq(
    "every drawable kind becomes a candidate",
    Object.keys(byId).sort(),
    ["fence", "home", "path", "ring", "track:uav-1", "uav-1", "wp-1"],
  );
  eq("a drop line is not pickable", byId.drop, undefined);
  eq("a one-point track is not pickable", candidates.filter((entry) => entry.kind === "track").length, 1);
  eq("an object is measured in pixels around its icon", byId["uav-1"].kind, "object");
  ok("the object carries its rendered size", byId["uav-1"].radiusPx >= 10);
  eq("a circle keeps its radius in metres", byId.ring.radiusM, 300);
  eq("a polygon keeps its ring", byId.fence.polygon.length, 3);

  const onlyObjects = core.hitCandidates(store.snapshot(), [], { include: ["object"] });
  eq("a caller can restrict what is pickable", onlyObjects.map((entry) => entry.kind), ["object"]);
}

/* ── 8. selection ────────────────────────────────────────────────────── */
{
  const selection = new core.SelectionStore({ multi: true });
  let updates = 0;
  selection.subscribe(() => updates++);

  selection.select({ id: "uav-1", kind: "object" });
  eq("one item is selected", selection.ids, ["uav-1"]);
  eq("the kind is kept", selection.get("uav-1").kind, "object");

  selection.select({ id: "path", kind: "polyline" }, { additive: true });
  eq("additive select keeps both", selection.ids.sort(), ["path", "uav-1"]);
  selection.select({ id: "path", kind: "polyline" }, { additive: true });
  eq("…and toggles one off", selection.ids, ["uav-1"]);

  selection.select({ id: "fence", kind: "polygon" });
  eq("a plain select replaces", selection.ids, ["fence"]);
  selection.setMany([{ id: "a", kind: "object" }, { id: "b", kind: "marker" }]);
  eq("setMany replaces the whole selection", selection.size, 2);
  selection.clear();
  eq("clear empties it", selection.ids, []);
  ok("subscribers were notified on every change", updates >= 6, `${updates} updates`);
  eq("a hit converts to a selection entry", core.entryOf({ id: "x", kind: "track" }), { id: "x", kind: "track" });
  eq("null hit clears", core.entryOf(null), null);
}
/* ── 9. measure ──────────────────────────────────────────────────────── */
{
  const cairo = { lat: 30.0444, lon: 31.2357 };
  const alex = { lat: 31.2001, lon: 29.9187 };
  near("a path is the sum of its legs", core.pathLengthM([cairo, { lat: 30.5, lon: 31 }, alex]), 180000, 12000);
  near("one leg matches the great circle", core.pathLengthM([cairo, alex]), core.distanceMeters(cairo, alex), 1e-6);

  const square = [
    { lat: 30.0, lon: 31.0 },
    { lat: 30.001, lon: 31.0 },
    { lat: 30.001, lon: 31.001 },
    { lat: 30.0, lon: 31.001 },
  ];
  const sideLat = core.distanceMeters({ lat: 30.0, lon: 31.0 }, { lat: 30.001, lon: 31.0 });
  const sideLon = core.distanceMeters({ lat: 30.0, lon: 31.0 }, { lat: 30.0, lon: 31.001 });
  near("a perimeter closes the ring", core.perimeterM(square), 2 * (sideLat + sideLon), 0.01);
  near("an area is the rectangle it is", core.polygonAreaM2(square), sideLat * sideLon, sideLat * sideLon * 0.02);
  ok("an area is never negative", core.polygonAreaM2([...square].reverse()) === core.polygonAreaM2(square));
  eq("a degenerate polygon has no area", core.polygonAreaM2([square[0], square[1]]), 0);

  /* a polygon across the antimeridian must be small, not the rest of the world */
  const antimeridian = [
    { lat: 10, lon: 179.999 },
    { lat: 10.001, lon: 179.999 },
    { lat: 10.001, lon: -179.999 },
    { lat: 10, lon: -179.999 },
  ];
  ok("a polygon across the antimeridian stays small", core.polygonAreaM2(antimeridian) < 100000, `${core.polygonAreaM2(antimeridian)} m2`);

  const centre = core.centroid(square);
  near("a centroid is the mean", centre.lat, 30.0005, 1e-9);
  near("…in both axes", centre.lon, 31.0005, 1e-9);
  eq("no points, no centroid", core.centroid([]), null);
  near("a bearing is the initial one", core.bearingAlong([cairo, alex]), 316, 4);

  eq("distances read like a UI", core.formatDistance(540.2), "540 m");
  eq("…with one decimal when small", core.formatDistance(8.44), "8.4 m");
  eq("…in km when long", core.formatDistance(1423.4), "1.42 km");
  eq("…and rounded when very long", core.formatDistance(1234567), "1235 km");
  eq("areas read like a UI", core.formatArea(860), "860 m2");
  eq("…in hectares when large", core.formatArea(14000), "1.40 ha");
  eq("…in km2 when huge", core.formatArea(12345678), "12.35 km2");
  eq("nonsense is not printed as a number", core.formatDistance(NaN), "—");
}

/* ── 10. history (undo / redo) ───────────────────────────────────────── */
{
  const history = new core.HistoryStore({ limit: 3, coalesceMs: 400, initial: { n: 0 } });
  let updates = 0;
  history.subscribe(() => updates++);
  eq("an initial state is not undoable", history.canUndo, false);

  history.push({ n: 1 }, "add", 1000);
  history.push({ n: 2 }, "add", 2000);
  eq("two steps can be undone", history.undoStack.length, 2);
  eq("undo walks back", history.undo().n, 1);
  eq("…and redo walks forward", history.redo().n, 2);
  eq("a new edit clears the redo branch", history.push({ n: 3 }, "add", 9000).n, 3);
  eq("…so there is nothing to redo", history.canRedo, false);

  /* coalescing: the same label inside the window is ONE step (a slider drag) */
  const drag = new core.HistoryStore({ coalesceMs: 400, initial: { alt: 0 } });
  drag.push({ alt: 100 }, "altitude", 1000);
  drag.push({ alt: 150 }, "altitude", 1100);
  drag.push({ alt: 200 }, "altitude", 1200);
  eq("a gesture is one undo step", drag.undoStack.length, 1);
  eq("…holding the LAST value of the gesture", drag.present.alt, 200);
  drag.push({ alt: 300 }, "colour", 1300);
  eq("a different intent starts a new step", drag.undoStack.length, 2);

  /* the depth limit drops the oldest steps */
  const limited = new core.HistoryStore({ limit: 2, coalesceMs: 0 });
  for (let i = 1; i <= 5; i++) limited.push({ n: i }, `step ${i}`, i * 1000);
  limited.undo();
  limited.undo();
  eq("the depth limit stops the undo walk", limited.canUndo, false);

  ok("subscribers saw the changes", updates >= 3, `${updates} updates`);
}

console.log(failures === 0 ? "\nINTERACTION CHECKS PASSED" : `\n${failures} INTERACTION ERROR(S)`);
process.exit(failures === 0 ? 0 : 1);
