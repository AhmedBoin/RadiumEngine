// scripts/check-core.mjs — dependency free assertions for @radium-engine/core.
// Run `npm run build --workspace @radium-engine/core` first (same contract as the
// style/tile checks in Radium): the checks exercise the compiled output.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(root, "packages", "core", "dist", "index.js");

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
const ok = (label, condition) => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
};

/* ── geo ─────────────────────────────────────────────────────────────── */
const merc = core.mercatorAt(30.0444, 31.2357, 0);
near("mercator x of Cairo", merc.x, 0.586766, 1e-5);
ok("mercator y of Cairo is in the northern half (y < 0.5)", merc.y > 0.4 && merc.y < 0.5);
near(
  "altitude 100 m survives the mercator round trip (same latitude)",
  core.latLngFromMercator(merc.x, merc.y, core.mercatorZfromAltitude(100, 30.0444)).alt,
  100,
  1e-3,
);
near("metres per pixel at z10/lat30", core.metresPerPixel(30, 10), 132.4, 0.6);
near("metres per pixel at z10/equator", core.metresPerPixel(0, 10), 152.87, 0.6);
near(
  "distance Cairo -> Alexandria",
  core.distanceMeters({ lat: 30.0444, lon: 31.2357 }, { lat: 31.2001, lon: 29.9187 }),
  180000,
  6000,
);
near("bearing due east", core.bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 0.01);
const ring = core.circle({ lat: 30, lon: 31 }, 100);
ok("a circle closes on itself", core.distanceMeters(ring[0], ring[ring.length - 1]) < 1e-6);

/* ── tile math + URLs ────────────────────────────────────────────────── */
const tile = core.lngLatToTile(30.0444, 31.2357, 10);
eq("tile of Cairo at z10", { x: tile.x, y: tile.y }, { x: 600, y: 422 });
eq("quadkey of the classic example", core.toQuadKey(3, 5, 3), "213");
eq(
  "subdomain placeholder",
  core.resolveTileUrl("https://{s}.tile.example/{z}/{x}/{y}.png", 3, 1, 2, ["a", "b", "c"]),
  "https://a.tile.example/3/1/2.png",
);
eq(
  "bing quadkey placeholder",
  core.resolveTileUrl("https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1", 1, 0, 0, [0, 1]),
  "https://ecn.t0.tiles.virtualearth.net/tiles/a0.jpeg?g=1",
);
ok(
  "prefetch tile plan is not empty",
  core.tilesForBounds({ west: 31.1, south: 30, east: 31.4, north: 30.2 }, 12, 13).length > 20,
);

/* ── providers ───────────────────────────────────────────────────────── */
ok("imagery providers are grouped", core.imageryProviderGroups().length >= 5);
eq("esri imagery resolves", core.imageryProviderFor("ESRI.WorldImagery").id, "ESRI.WorldImagery");
eq("unknown imagery falls back", core.imageryProviderFor("nope").id, core.DEFAULT_IMAGERY_PROVIDER);
eq("custom imagery needs a url", core.imageryProviderFor("custom", "").id, core.DEFAULT_IMAGERY_PROVIDER);
eq("terrain default is aws terrarium", core.terrainSourceFor({}).id, "aws-terrarium");
eq("3dep is a geotiff source", core.terrainSourceFor({ provider: "aws-3dep" }).geotiffTiles, true);
eq("no terrain provider is RGB", core.TERRAIN_PROVIDERS.every((p) => p.encoding === "terrarium"), true);
eq(
  "smoothing gets its own folder",
  core.terrainSourceFor({ provider: "aws-terrarium", smoothing: 2 }).folder,
  "Terrarium_S2",
);


/* ── elevation packing ───────────────────────────────────────────────── */
eq("terrarium round trip", core.demDecodeElevation("terrarium", ...core.demEncodeTerrarium(321)), 321);
eq("terrarium sea level", core.demDecodeElevation("terrarium", ...core.demEncodeTerrarium(0)), 0);
eq(
  "terrarium below sea level",
  Math.round(core.demDecodeElevation("terrarium", ...core.demEncodeTerrarium(-40))),
  -40,
);
near(
  "mapbox decode",
  core.demDecodeElevation("mapbox", 1, 2, 3),
  -10000 + (1 * 65536 + 2 * 256 + 3) * 0.1,
);
const heights = new Float32Array(256 * 256).fill(100);
heights[10 * 256 + 10] = 1000;
const smoothed = core.smoothHeights(heights, 2);
ok("smoothing keeps the average", Math.abs(smoothed[20 * 256 + 20] - 100) < 1);
ok("smoothing softens a spike", smoothed[10 * 256 + 10] < 1000 && smoothed[10 * 256 + 10] > 100);

/* ── motion ──────────────────────────────────────────────────────────── */
const jump = new core.PoseInterpolator({ mode: "jump" });
jump.push({ lat: 0, lon: 0, alt: 0, roll: 0, pitch: 0, yaw: 0 }, 0);
jump.push({ lat: 0.001, lon: 0, alt: 10, roll: 0, pitch: 0, yaw: 90 }, 1000);
eq("jump mode reports the newest pose", jump.sample(1200).lat, 0.001);

const smooth = new core.PoseInterpolator({ mode: "smooth", lagMs: 200 });
for (let i = 0; i <= 10; i++) {
  smooth.push({ lat: i * 0.001, lon: 0, alt: i, roll: 0, pitch: 0, yaw: i }, i * 100);
}
const mid = smooth.sample(1000);
ok("smooth mode interpolates between samples", mid.lat > 0.006 && mid.lat < 0.0092);
ok("smooth mode extrapolates instead of freezing", smooth.sample(5000).lat > smooth.lastPose.lat);

/* ── tracks ──────────────────────────────────────────────────────────── */
const track = new core.TrackRecorder({ id: "t", maxPoints: 5 });
for (let i = 0; i < 10; i++) track.push({ lat: i * 0.001, lon: 0, alt: 10 }, i * 1000);
eq("maxPoints is enforced", track.count, 5);

const timed = new core.TrackRecorder({ id: "t2", maxSeconds: 2 });
for (let i = 0; i < 10; i++) timed.push({ lat: i * 0.001, lon: 0, alt: 10 }, i * 1000);
ok("maxSeconds is enforced", timed.durationMs <= 4000);

const straight = [];
for (let i = 0; i < 50; i++) straight.push({ lat: 30 + i * 0.0001, lon: 31, alt: 0 });
straight[25].lon += 0.00002;
const simplified = core.simplifyPath(straight, 1, core.distanceMeters);
ok(
  "simplifyPath drops collinear points",
  simplified.length < straight.length && simplified.length >= 3,
);

/* ── scene store ─────────────────────────────────────────────────────── */
const store = new core.SceneStore();
let notified = 0;
store.subscribe(() => notified++);
store.setPose("uav-1", { lat: 30, lon: 31, alt: 100, roll: 0, pitch: 0, yaw: 45 }, { mode: "jump" });
store.ensureTrack("uav-1", { maxPoints: 10 }).push({ lat: 30, lon: 31, alt: 100 });
eq("object count", store.snapshot().objects.length, 1);
eq("display pose comes from the store", Math.round(store.displayPose("uav-1").alt), 100);
store.setShape({ kind: "circle", id: "ring", center: { lat: 30, lon: 31 }, radiusM: 50 });
eq("shape registry", store.snapshot().shapes.length, 1);
ok("subscribers were notified", notified >= 3);

console.log(failures === 0 ? "\nALL CORE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
