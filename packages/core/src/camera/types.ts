// src/camera/types.ts — the vocabulary of the camera system.
//
// A "camera mode" is a rule for deriving the MAP camera (what the engine renders
// with) from an OBJECT's pose (what the simulation says). The rules live in
// `rig.ts`; the maths they are built from lives in `framing.ts`, `fpv.ts` and
// `follow.ts`, so every piece can be verified headless (`npm run check:camera`).
import type { LatLng } from "../types";

/** Position + attitude of whatever the camera looks at (`Pose6` minus the noise). */
export type FollowTarget = {
  lat: number;
  lon: number;
  /** metres MSL */
  alt: number;
  /** degrees, 0 = north, clockwise */
  heading: number;
  /** degrees, nose up positive */
  pitch: number;
  /** degrees, right wing down positive */
  roll: number;
};

/**
 * How the camera treats the followed object.
 *
 * - `free`   the camera is the user's; nothing is driven (the rig returns null)
 * - `follow` the map centre tracks the object: the user's bearing/pitch/zoom are
 *            kept and the object is held at `screenFractionPct` of the viewport
 * - `chase`  third person: the eye sits behind and above the object, aiming along
 *            its heading with `chasePitchDeg`, holding it at `screenFractionPct`
 * - `fpv`    first person: the eye IS the object, attitude per `fpvModel`
 */
export type CameraMode = "free" | "follow" | "chase" | "fpv";

/** The `fpvModel` options: bolted to the object, or gimbal stabilised. */
export type FpvCameraModel = "fixed" | "gimbal";

/** Which freedoms each FPV model gives the object (see `fpvAttitude`). */
export type CameraTuning = {
  /** response time of the follow filter's position channels, ms */
  positionMs?: number;
  /** response time of the follow filter's attitude channels, ms */
  angleMs?: number;
  /** how fast the view may chase a teleport, m/s (0 = unlimited) */
  speedLimitMps?: number;
  /** vertical speed limit, m/s (default 0.5 × the horizontal one) */
  climbLimitMps?: number;
  /** heading limit, deg/s (default 90) */
  turnLimitDegPerSec?: number;
  /** where the followed object sits vertically on screen (50 = centred) */
  screenFractionPct?: number;
  /** chase camera: the pitch the eye looks at the object with */
  chasePitchDeg?: number;
  /** chase camera: how far from the eye the object should sit, m (default: from the zoom) */
  chaseDistanceM?: number;
  /** FPV: which camera model drives the attitude */
  fpvModel?: FpvCameraModel;
  /** FPV `fixed` model: the mount angle in degrees (positive looks up) */
  fpvMountPitchDeg?: number;
  /** vertical field of view of the (virtual) lens, degrees */
  fovDeg?: number;
  /** extra FPV zoom on top of the altitude-derived zoom (0 = none) */
  zoomOffset?: number;
};

/** A frame of the rig: how the map camera should be set. */
export type CameraFrame = {
  mode: Exclude<CameraMode, "free">;
  /**
   * `centre` — the map is centred on the ground (`center` + `elevation` are the map
   *            centre): what `follow` needs.
   * `eye`    — the EYE is the followed object (or sits behind it) and `center` /
   *            `elevation` are derived: what `chase` and `fpv` need, because a map
   *            camera can only be centred on the GROUND and an object at altitude
   *            projects away from its footprint by `alt / metresPerPixel` pixels.
   */
  kind: "centre" | "eye";
  /** the map centre (always ground: the engines jump the camera here) */
  center: LatLng;
  /** the ground elevation of that centre, in metres */
  elevation: number;
  zoom: number;
  /** degrees, measured from straight down (0 = top-down, 90 = the horizon) */
  pitch: number;
  /** degrees, 0 = north */
  bearing: number;
  /** degrees, screen roll (FPV `fixed` banks with the object) */
  roll: number;
  /** where the eye is, when the mode places one (chase, fpv) */
  eye?: { lat: number; lon: number; altMsl: number };
  /** eye -> object distance, metres (diagnostics) */
  distanceM: number;
};
