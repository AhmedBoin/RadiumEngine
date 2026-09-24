// scripts/check-camera.mjs — the camera modes, verified numerically.
//
// Run `npm run build --workspace @radium-engine/core` first (the checks exercise the
// compiled output, the same contract as `check-core.mjs`).
//
// None of this can be eyeballed in a headless run, and every property below was a real
// bug in the app this engine was extracted from:
//
//   1. a follow mode that centres the object's GROUND FOOTPRINT lets it drift up the
//      screen by the altitude parallax `alt / metresPerPixel` (~490 px at zoom 18 for
//      100 m) — so the framing is asserted by PROJECTING the object through the map
//      camera model, not by trusting the algebra that built it;
//   2. an eye placement must round-trip through the same model (place the eye, read it
//      back) or a "pinned" camera drifts as the pitch/zoom changes;
//   3. a rate-limited follow filter that is NOT seeded glides in from (0, 0);
//   4. a discrete alpha-beta filter overshoots, so "no overshoot" is asserted directly.
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
const near = (label, actual, expected, tolerance = 1e-6) => {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` (got ${actual}, want ~${expected})`}`);
};
const ok = (label, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${condition || !detail ? "" : ` (${detail})`}`);
};

const H = 1080;

/** Distance in the MAP frame (mercator metres) — the frame the camera works in. */
const mercatorMetres = (a, b, latRef) => {
  const scale = 2 * Math.PI * 6378137 * Math.cos(((latRef ?? a.lat) * Math.PI) / 180);
  const A = core.mercatorAt(a.lat, a.lon);
  const B = core.mercatorAt(b.lat, b.lon);
  return Math.hypot((B.x - A.x) * scale, (B.y - A.y) * scale);
};
const FOV = core.DEFAULT_FOV_DEG;
const LAT = 30.0444;
const LON = 31.2357;

/** Project a point through the map-camera model that a frame describes. */
const screenY = (frame, lat, lon, altMsl) =>
  core.verticalScreenYFor({
    centerLat: frame.center.lat,
    centerLon: frame.center.lon,
    elevation: frame.elevation,
    pitchDeg: frame.pitch,
    bearingDeg: frame.bearing,
    zoom: frame.zoom,
    heightPx: H,
    fovDeg: FOV,
    lat,
    lon,
    altMsl,
  });
/* ── 1. the map camera model is the inverse of an eye placement ──────── */
{
  let worst = 0;
  for (const zoom of [13, 16, 19]) {
    for (const pitch of [0, 30, 60, 88]) {
      for (const alt of [0, 120, 900]) {
        const placement = core.eyePlacement({
          eyeLat: LAT,
          eyeLng: LON,
          eyeAltMsl: alt,
          bearingDeg: 137,
          pitchDeg: pitch,
          zoom,
          heightPx: H,
          fovDeg: FOV,
        });
        const eye = core.cameraEyeFor({
          centerLat: placement.center.lat,
          centerLon: placement.center.lon,
          elevation: placement.elevation,
          pitchDeg: pitch,
          bearingDeg: 137,
          zoom,
          heightPx: H,
          fovDeg: FOV,
        });
        /* relative to the offset: the placement is its own inverse to within the
           projection is own distortion over the leg (Web Mercator is only
           scale-accurate AT a latitude, so two legs of kilometres cannot cancel
exactly) */
        const offsetM = Math.max(1, placement.distanceM * Math.sin((pitch * Math.PI) / 180));
        const errorM = mercatorMetres({ lat: eye.lat, lon: eye.lon }, { lat: LAT, lon: LON }, LAT);
        worst = Math.max(worst, errorM / offsetM, Math.abs(eye.altMsl - alt) / offsetM);
      }
    }
  }
  ok(
    "eye placement round-trips within the projection distortion (0.5% of the offset)",
    worst < 5e-3,
    `worst ${worst.toExponential(2)} relative`,
  );
}
/* ── 2. the chase camera frames the object at the fraction, exactly ──── */
{
  let worstPx = 0;
  let worstDistance = 0;
  let minAbove = Infinity;
  for (const zoom of [13, 16, 19]) {
    for (const pitch of [20, 45, 70]) {
      for (const fraction of [0.35, 0.5, 0.6, 0.8]) {
        for (const alt of [0, 100, 500]) {
          const placement = core.chaseEyePlacement({
            targetLat: LAT,
            targetLon: LON,
            targetAltMsl: alt,
            bearingDeg: 45,
            pitchDeg: pitch,
            fraction,
            zoom,
            heightPx: H,
            fovDeg: FOV,
          });
          const y = screenY(
            { center: placement.center, elevation: placement.elevation, pitch, bearing: 45, zoom },
            LAT,
            LON,
            alt,
          );
          if (y !== null) worstPx = Math.max(worstPx, Math.abs(y - fraction * H));
          minAbove = Math.min(minAbove, placement.aboveM);

          /* the eye sits behind the object by the distance the zoom asked for */
          const actual = mercatorMetres({ lat: placement.eye.lat, lon: placement.eye.lon }, { lat: LAT, lon: LON }, LAT);
          worstDistance = Math.max(worstDistance, Math.abs(actual - placement.behindM));
        }
      }
    }
  }
  /* 2 px rather than 1: the two places the mercator scale is evaluated (the eye and the
   centre) differ by the offset, which is the projection own distortion — the native
   MapLibre solver the engines use at runtime has no such gap */
  ok("chase holds the object at the screen fraction (<2 px)", worstPx < 2, `worst ${worstPx.toFixed(3)} px`);
  ok(
    "the chase eye is behind the object by the requested distance (<0.5 m)",
    worstDistance < 0.5,
    `worst ${worstDistance.toFixed(3)} m`,
  );
  ok("the chase eye is always ABOVE the object", minAbove > 0, `min ${minAbove.toFixed(2)} m`);
}
/* ── 3. the follow (auto pan) mode cancels the altitude parallax ─────── */
{
  let worstPx = 0;
  let worstParallaxPx = 0;
  for (const zoom of [13, 16, 19]) {
    for (const pitch of [0, 30, 60]) {
      for (const fraction of [0.5, 0.65]) {
        for (const alt of [0, 100, 500]) {
          const distanceM = core.cameraGroundDistanceM(H, LAT, zoom, FOV);
          const ahead = core.followCentreOffsetM({
            altitudeM: alt,
            groundDistanceM: distanceM,
            pitchDeg: pitch,
            fraction,
            fovDeg: FOV,
          });
          const center = core.offsetLatLng(LAT, LON, 45, ahead);
          const y = screenY({ center, elevation: 0, pitch, bearing: 45, zoom }, LAT, LON, alt);
          if (y !== null) worstPx = Math.max(worstPx, Math.abs(y - fraction * H));

          /* what centring the FOOTPRINT (ahead = 0) would have done */
          const naive = screenY(
            { center: { lat: LAT, lon: LON }, elevation: 0, pitch, bearing: 45, zoom },
            LAT,
            LON,
            alt,
          );
          if (naive !== null) {
            worstParallaxPx = Math.max(worstParallaxPx, Math.abs(naive - fraction * H));
          }
        }
      }
    }
  }
  ok("follow holds the object at the screen fraction (<1 px)", worstPx < 1, `worst ${worstPx.toFixed(3)} px`);
  ok(
    "the bug it fixes is real: centring the footprint drifts hundreds of px",
    worstParallaxPx > 100,
    `worst ${worstParallaxPx.toFixed(1)} px`,
  );
}
/* ── 4. the lens: FPV zoom <-> altitude, and the FPV pitch ───────────── */
{
  const alt = 250;
  const zoom = core.fpvZoomForAltitude(alt, LAT, H, FOV);
  near("FPV zoom round-trips to the altitude it came from", core.fpvEyeAltitudeForZoom(zoom, LAT, H, FOV), alt, 5);
  ok("FPV zoom is coarser up high (the ground scale of an eye)", core.fpvZoomForAltitude(1000, LAT, H, FOV) < zoom);
  ok("FPV zoom stays inside its clamp", zoom >= core.FPV_MIN_ZOOM - 1e-9 && zoom <= core.FPV_MAX_ZOOM + 1e-9);

  near("a level cruise looks at the horizon", core.fpvPitch(core.HORIZON_PITCH_DEG, 0), core.HORIZON_PITCH_DEG);
  near(
    "a dive tilts the view down with the nose",
    core.fpvPitch(core.HORIZON_PITCH_DEG, -20),
    core.HORIZON_PITCH_DEG - 20,
  );
  near(
    "a climb stops at the horizon (no sky in mercator)",
    core.fpvPitch(core.HORIZON_PITCH_DEG, 40),
    core.HORIZON_PITCH_DEG,
  );
  ok("FPV pitch never looks below 45 degrees", core.fpvPitch(core.HORIZON_PITCH_DEG, -80) >= 45);
}

/* ── 5. the FPV camera models: which freedoms each one gives ─────────── */
{
  const fixed = core.fpvAttitude({
    model: "fixed",
    headingDeg: 90,
    objectPitchDeg: -10,
    objectRollDeg: 22,
    mountPitchDeg: 8,
  });
  near("fixed: bearing is the object heading", fixed.bearingDeg, 90);
  near("fixed: the mount angle adds to the object pitch", fixed.pitchDeg, core.HORIZON_PITCH_DEG - 2, 1e-9);
  near("fixed: the view banks with the object", fixed.rollDeg, 22);

  const gimbal = core.fpvAttitude({
    model: "gimbal",
    headingDeg: 90,
    objectPitchDeg: -10,
    objectRollDeg: 22,
    mountPitchDeg: 8,
  });
  near("gimbal: bearing is still the object heading", gimbal.bearingDeg, 90);
  near("gimbal: the horizon stays level (roll stabilised)", gimbal.rollDeg, 0);
  near("gimbal: the pitch ignores the object attitude", gimbal.pitchDeg, core.HORIZON_PITCH_DEG, 1e-9);
}
/* ── 6. the follow filter ────────────────────────────────────────────── */
{
  const target = (lat) => ({ lat, lon: LON, alt: 100, heading: 0, pitch: 0, roll: 0 });

  /* seeded: the first frame places the camera ON the object, never at (0, 0) */
  const fresh = core.createCameraFollow();
  const first = core.stepCameraFollow(fresh, target(LAT), 16.7, { speedLimitMps: 80 });
  near("the filter is seeded (no glide in from 0,0)", first.lat, LAT, 1e-12);

  /* a step must never overshoot or ring */
  const state = core.createCameraFollow();
  core.stepCameraFollow(state, target(LAT), 16.7, { positionMs: 400, speedLimitMps: 0 });
  let overshoot = 0;
  let previous = LAT;
  for (let i = 0; i < 240; i++) {
    const pose = core.stepCameraFollow(state, target(LAT + 0.01), 16.7, {
      positionMs: 400,
      speedLimitMps: 0,
    });
    overshoot = Math.max(overshoot, pose.lat - (LAT + 0.01), previous - pose.lat);
    previous = pose.lat;
  }
  ok("a step never overshoots or rings", overshoot < 1e-12, `worst ${overshoot}`);

  /* a constant velocity target is tracked with no steady-state lag */
  const ramp = core.createCameraFollow();
  core.stepCameraFollow(ramp, target(LAT), 16.7, { positionMs: 400, speedLimitMps: 0 });
  const rampPoseAt = (ms) => LAT + 0.00002 * Math.floor(ms / 100) * 0.05;
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += 16.7;
    core.stepCameraFollow(ramp, target(rampPoseAt(t)), 16.7, { positionMs: 400, speedLimitMps: 0 });
  }
  const lagM = core.distanceMeters({ lat: ramp.pose.lat, lon: LON }, { lat: rampPoseAt(t), lon: LON });
  ok("a steady target is tracked without lag (<2 m behind)", lagM < 2, `${lagM.toFixed(2)} m`);

  /* a teleport is chased at the speed limit, not copied */
  const limited = core.limitFollowTarget(ramp.pose, target(LAT + 0.05), 100, { speedLimitMps: 80 });
  const stepped = core.distanceMeters({ lat: ramp.pose.lat, lon: LON }, { lat: limited.lat, lon: LON });
  ok("a teleport is rate limited to speedLimit x dt", stepped > 6.5 && stepped < 8.5, `${stepped.toFixed(2)} m`);

  /* with no previous pose the limit must NOT engage (the (0,0) bug) */
  const unlimited = core.limitFollowTarget(null, target(LAT), 100, { speedLimitMps: 80 });
  near("an unseeded limit passes the target through", unlimited.lat, LAT, 1e-12);
}
/* ── 7. screen geometry helpers ──────────────────────────────────────── */
{
  const at50 = core.chaseScreenY(H, core.chaseScreenFraction(50));
  const at60 = core.chaseScreenY(H, core.chaseScreenFraction(60));
  near("the screen fraction of 50% is the centre", at50, H / 2, 1e-9);
  near("the screen fraction of 60% is 60% down", at60, H * 0.6, 1e-9);
  near("the fraction clamps at 10%", core.chaseScreenFraction(0), 0.1);
  near("the fraction clamps at 90%", core.chaseScreenFraction(1000), 0.9);

  const atHorizon = core.horizonScreenY(H, core.HORIZON_PITCH_DEG, FOV);
  ok(
    "the horizon sits on the centre line at the mercator limit",
    Math.abs(atHorizon - H / 2) < H * 0.06,
    `${atHorizon.toFixed(1)} vs ${H / 2}`,
  );
  ok("looking straight down puts the horizon far above the canvas", core.horizonScreenY(H, 0, FOV) < 0);
  ok("tilt more, raise the horizon", core.horizonScreenY(H, 60, FOV) > core.horizonScreenY(H, 30, FOV));

  near("ground distance at zoom 19 / equator (~484 m)", core.cameraGroundDistanceM(H, 0, 19, FOV), 484, 4);
}

/* ── 8. the rig drives every mode ────────────────────────────────────── */
{
  const pose = { lat: LAT, lon: LON, alt: 300, heading: 75, pitch: -5, roll: 12 };
  const input = { viewport: { widthPx: 1920, heightPx: H }, user: { zoom: 16, pitch: 55, bearing: 20 } };

  const free = new core.CameraRig("free");
  ok("free mode drives nothing", free.update({ ...input, dtMs: 0, target: pose }) === null);

  const follow = new core.CameraRig("follow", { screenFractionPct: 55 });
  const followFrame = follow.update({ ...input, dtMs: 0, target: pose });
  near("follow keeps the user zoom", followFrame.zoom, 16);
  near("follow keeps the user bearing", followFrame.bearing, 20);
  const followY = screenY(followFrame, pose.lat, pose.lon, pose.alt);
  ok("follow puts the object at its fraction", Math.abs(followY - H * 0.55) < 1, `y ${followY.toFixed(2)}`);

  const chase = new core.CameraRig("chase", { chasePitchDeg: 40, screenFractionPct: 60 });
  const chaseFrame = chase.update({ ...input, dtMs: 0, target: pose });
  near("chase aims along the object heading", chaseFrame.bearing, 75);
  near("chase uses the tuned pitch", chaseFrame.pitch, 40);
  ok("chase places an eye behind the object", chaseFrame.distanceM > 10);
  const chaseY = screenY(chaseFrame, pose.lat, pose.lon, pose.alt);
  ok("chase puts the object at its fraction", Math.abs(chaseY - H * 0.6) < 1, `y ${chaseY.toFixed(2)}`);

  const fpv = new core.CameraRig("fpv", { fpvModel: "gimbal" });
  const fpvFrame = fpv.update({ ...input, dtMs: 0, target: pose });
  near("fpv puts the eye on the object", fpvFrame.eye.lat, pose.lat, 1e-9);
  near("fpv puts the eye at the object altitude", fpvFrame.eye.altMsl, 300, 1e-9);
  near("fpv (gimbal) does not bank", fpvFrame.roll, 0);
  ok("fpv derives its zoom from the altitude", fpvFrame.zoom > core.FPV_MIN_ZOOM);

  /* a mode change re-seeds the filter, so nothing glides in from the old mode */
  fpv.setMode("chase");
  const switched = fpv.update({ ...input, dtMs: 0, target: pose });
  ok("a mode change switches the frame", switched.mode === "chase");
}

console.log(failures === 0 ? "\nCAMERA CHECKS PASSED" : `\n${failures} CAMERA ERROR(S)`);
process.exit(failures === 0 ? 0 : 1);




