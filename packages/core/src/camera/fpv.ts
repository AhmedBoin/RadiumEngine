// src/camera/fpv.ts — the first-person camera model.
//
// Both models aim from the same eye (the object itself, placed by `eyePlacement` in
// `framing.ts`), so this file only decides the ATTITUDE and the lens:
//
//   fixed    bolted to the object — bearing, pitch AND roll come from it, so the
//            view banks and pitches with it (a camera on a drone's nose)
//   gimbal   follows it in position and yaw only — roll stabilised to 0, pitch
//            stabilised to the horizon, and the pilot's own look added on top
//
// The contract ("which freedoms does each model get") is exactly the kind of rule
// that regresses silently, so `npm run check:camera` asserts it.
import { metresPerPixel } from "../geo/mercator";
import { clamp, normaliseAngle } from "../geo/sphere";
import { DEFAULT_FOV_DEG, FPV_MAX_ZOOM, FPV_MIN_ZOOM, HORIZON_PITCH_DEG } from "./framing";
import type { FpvCameraModel } from "./types";

/**
 * The map pitch of the FPV view. MapLibre measures pitch from straight down, so a
 * level cruise sits at `horizonPitchDeg` and a nose-down dive tilts the view *down*
 * with the object (`-objectPitch`, for the usual nose-up-positive convention). A
 * climb stops at the horizon, because a mercator map cannot look above it — that is
 * what a sky layer adds visually (`horizonScreenY` says where).
 */
export function fpvPitch(horizonPitchDeg: number, objectPitchDeg: number): number {
  const horizon = Number.isFinite(horizonPitchDeg)
    ? clamp(horizonPitchDeg, 0, 90)
    : HORIZON_PITCH_DEG;
  const object = Number.isFinite(objectPitchDeg) ? objectPitchDeg : 0;
  const lowest = Math.min(horizon, 45);
  return Math.max(lowest, Math.min(horizon, horizon + object));
}

/**
 * The zoom at which the ground is drawn at the scale an eye `altM` metres above it,
 * behind a `fovDeg` lens, would see it (a vertical footprint of
 * `2·tan(fov/2)·altM` across the canvas). This is what makes FPV feel like it is up
 * there: the same ground at a coarser scale the higher the object is.
 *
 * Note what a map camera *cannot* do: at pitch ~89 its eye sits at ground level (its
 * height above the centre is `distance · cos(pitch)`), so this matches the ground
 * scale, not the eye position. An FPV view therefore hides the object's own model,
 * which is why that is invisible.
 */
export function fpvZoomForAltitude(
  altM: number,
  latDeg: number,
  heightPx: number,
  fovDeg: number = DEFAULT_FOV_DEG,
): number {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 800);
  const alt = Math.max(1, Number.isFinite(altM) ? altM : 100);
  const lat = Number.isFinite(latDeg) ? latDeg : 0;
  const fov = Number.isFinite(fovDeg) ? clamp(fovDeg, 1, 120) : DEFAULT_FOV_DEG;

  const verticalFootprintM = 2 * Math.tan((fov * Math.PI) / 360) * alt;
  const metresPerPixelWanted = verticalFootprintM / height;
  /* metresPerPixel(lat, zoom) = metresPerPixel(lat, 0) / 2^zoom, so the inverse is
     exact by construction — sharing the one formula keeps the two in step */
  const zoom = Math.log2(metresPerPixel(lat, 0) / Math.max(1e-9, metresPerPixelWanted));
  return clamp(zoom, FPV_MIN_ZOOM, FPV_MAX_ZOOM);
}

/** The inverse of `fpvZoomForAltitude`: the eye altitude a zoom implies. */
export function fpvEyeAltitudeForZoom(
  zoom: number,
  latDeg: number,
  heightPx: number,
  fovDeg: number = DEFAULT_FOV_DEG,
): number {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 800);
  const fov = Number.isFinite(fovDeg) ? clamp(fovDeg, 1, 120) : DEFAULT_FOV_DEG;
  const mpp = metresPerPixel(Number.isFinite(latDeg) ? latDeg : 0, Number.isFinite(zoom) ? zoom : 15);
  return (mpp * height) / (2 * Math.tan((fov * Math.PI) / 360));
}

export type FpvAttitude = {
  /** degrees, the direction the camera looks at */
  bearingDeg: number;
  pitchDeg: number;
  rollDeg: number;
};

/**
 * The attitude of the FPV camera, per model:
 *
 * - `fixed`  bearing / pitch / roll are the object's own (plus the optional mount
 *            angle, so a camera angled up on a nose-down glide still looks ahead)
 * - `gimbal` the object's heading, with a level horizon: roll 0 and pitch held at the
 *            horizon, which is why a bank or a nose-up attitude no longer tilts the
 *            view
 */
export function fpvAttitude(options: {
  model: FpvCameraModel;
  headingDeg: number;
  /** the object's own pitch, degrees (nose up positive) */
  objectPitchDeg: number;
  /** the object's own roll, degrees */
  objectRollDeg: number;
  /** the `fixed` model's mount angle, degrees (positive looks up) */
  mountPitchDeg?: number;
}): FpvAttitude {
  const heading = Number.isFinite(options.headingDeg) ? normaliseAngle(options.headingDeg) : 0;
  const objectPitch = Number.isFinite(options.objectPitchDeg) ? options.objectPitchDeg : 0;
  const objectRoll = Number.isFinite(options.objectRollDeg) ? options.objectRollDeg : 0;
  const mountPitch = Number.isFinite(options.mountPitchDeg) ? (options.mountPitchDeg as number) : 0;

  if (options.model === "gimbal") {
    return {
      bearingDeg: heading,
      pitchDeg: fpvPitch(HORIZON_PITCH_DEG, 0),
      rollDeg: 0,
    };
  }

  return {
    bearingDeg: heading,
    pitchDeg: fpvPitch(HORIZON_PITCH_DEG, objectPitch + mountPitch),
    rollDeg: objectRoll,
  };
}
