// src/camera/rig.ts — the camera modes, in one place.
//
// The rig turns "where the followed object is" into "where the map camera should
// be", for every mode. It is stateful only because of the follow filter: it holds the
// filtered pose, so a teleport is chased instead of copied and a jittery source does
// not shake the view (see `follow.ts`).
//
// Used by `<FollowCamera>` in @radium-engine/react, which pushes the frames into
// whichever engine is mounted. Nothing here touches an engine, which is what makes
// every mode verifiable headless (`npm run check:camera`).
import {
  cameraGroundDistanceM,
  chaseEyePlacement,
  chaseScreenFraction,
  eyePlacement,
  followCentreOffsetM,
  offsetLatLng,
} from "./framing";
import { fpvAttitude, fpvZoomForAltitude } from "./fpv";
import {
  createCameraFollow,
  limitFollowTarget,
  stepCameraFollow,
  type CameraFollowState,
} from "./follow";
import type { CameraFrame, CameraMode, CameraTuning, FollowTarget } from "./types";

export type RigInput = {
  /** milliseconds since the previous call (0 = place the camera, do not glide) */
  dtMs: number;
  /** the pose to follow, or null in `free` mode / with nothing selected */
  target: FollowTarget | null;
  viewport: { widthPx: number; heightPx: number };
  /** the user's own camera (what the engine reports when they move the map) */
  user: { zoom: number; pitch: number; bearing: number };
  /** ground elevation at a position, metres MSL (terrain); omit for a flat world */
  groundAt?: (lat: number, lon: number) => number;
};

/** What a rig uses before anything is configured. */
export const DEFAULT_CAMERA_TUNING: {
  positionMs: number;
  angleMs: number;
  screenFractionPct: number;
  chasePitchDeg: number;
  fpvModel: "fixed" | "gimbal";
  fpvMountPitchDeg: number;
  fovDeg: number;
  speedLimitMps: number;
} = {
  positionMs: 600,
  angleMs: 360,
  screenFractionPct: 55,
  chasePitchDeg: 45,
  fpvModel: "gimbal",
  fpvMountPitchDeg: 0,
  fovDeg: 36.87,
  speedLimitMps: 120,
};

/**
 * The camera rig. One instance per followed object: `setMode` when the user picks a
 * mode, `update` once per frame.
 */
export class CameraRig {
  private mode: CameraMode;
  private tuning: CameraTuning;
  private follow: CameraFollowState = createCameraFollow();
  private lastFrame: CameraFrame | null = null;

  constructor(mode: CameraMode = "free", tuning: CameraTuning = {}) {
    this.mode = mode;
    this.tuning = { ...DEFAULT_CAMERA_TUNING, ...tuning };
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    /* a mode change re-seeds the filter: the new mode must not glide in from wherever
       the old one happened to be */
    this.follow = createCameraFollow();
    this.lastFrame = null;
  }

  configure(tuning: CameraTuning): void {
    this.tuning = { ...this.tuning, ...tuning };
  }

  getTuning(): CameraTuning {
    return { ...this.tuning };
  }

  /** The frame the engine should apply, or null in `free` mode. */
  get frame(): CameraFrame | null {
    return this.lastFrame;
  }

  /** Forget the filtered pose (call when the followed object changes). */
  reset(): void {
    this.follow = createCameraFollow();
    this.lastFrame = null;
  }

  /** One frame: rate limit + filter the target, then compute the camera. */
  update(input: RigInput): CameraFrame | null {
    if (this.mode === "free" || !input.target) {
      this.lastFrame = null;
      return null;
    }

    const tuning = this.tuning;
    /* With an unseeded filter the target is passed through untouched: limiting from an
       unknown pose is what makes a follow camera drift in from (0, 0) instead of
       starting on the object. */
    const limited = this.follow.ready
      ? limitFollowTarget(this.follow.pose, input.target, input.dtMs, tuning)
      : { ...input.target };
    const pose = stepCameraFollow(this.follow, limited, input.dtMs, tuning);
    this.lastFrame = this.frameFor(pose, input);
    return this.lastFrame;
  }

  /**
   * The pure part: the camera a pose and a viewport imply for the current mode. No
   * state at all, so the check script drives it directly.
   */
  frameFor(pose: FollowTarget, input: Omit<RigInput, "target" | "dtMs">): CameraFrame {
    const heightPx = Math.max(1, input.viewport.heightPx);
    const fovDeg = this.tuning.fovDeg ?? DEFAULT_CAMERA_TUNING.fovDeg;
    const fraction = chaseScreenFraction(
      this.tuning.screenFractionPct ?? DEFAULT_CAMERA_TUNING.screenFractionPct,
    );
    const ground = input.groundAt?.(pose.lat, pose.lon) ?? 0;

    if (this.mode === "fpv") {
      const attitude = fpvAttitude({
        model: this.tuning.fpvModel ?? DEFAULT_CAMERA_TUNING.fpvModel,
        headingDeg: pose.heading,
        objectPitchDeg: pose.pitch,
        objectRollDeg: pose.roll,
        mountPitchDeg: this.tuning.fpvMountPitchDeg ?? DEFAULT_CAMERA_TUNING.fpvMountPitchDeg,
      });
      /* The lens IS the altitude: the ground is drawn at the scale an eye `alt` metres
         above it would see. `zoomOffset` is the pilot's own zoom on top of that. */
      const zoom = Math.max(
        0,
        fpvZoomForAltitude(pose.alt - ground, pose.lat, heightPx, fovDeg) +
          (this.tuning.zoomOffset ?? 0),
      );
      const placement = eyePlacement({
        eyeLat: pose.lat,
        eyeLng: pose.lon,
        eyeAltMsl: pose.alt,
        bearingDeg: attitude.bearingDeg,
        pitchDeg: attitude.pitchDeg,
        zoom,
        heightPx,
        fovDeg,
      });
      return {
        mode: "fpv",
        kind: "eye",
        center: placement.center,
        elevation: placement.elevation,
        zoom,
        pitch: attitude.pitchDeg,
        bearing: attitude.bearingDeg,
        roll: attitude.rollDeg,
        eye: { lat: pose.lat, lon: pose.lon, altMsl: pose.alt },
        distanceM: placement.distanceM,
      };
    }

    if (this.mode === "chase") {
      const pitch = Math.max(
        0,
        Math.min(89.9, this.tuning.chasePitchDeg ?? DEFAULT_CAMERA_TUNING.chasePitchDeg),
      );
      const placement = chaseEyePlacement({
        targetLat: pose.lat,
        targetLon: pose.lon,
        targetAltMsl: pose.alt,
        bearingDeg: pose.heading,
        pitchDeg: pitch,
        fraction,
        zoom: input.user.zoom,
        heightPx,
        fovDeg,
        distanceM: this.tuning.chaseDistanceM,
      });
      return {
        mode: "chase",
        kind: "eye",
        center: placement.center,
        elevation: placement.elevation,
        zoom: input.user.zoom,
        pitch,
        bearing: pose.heading,
        roll: 0,
        eye: placement.eye,
        distanceM: placement.toObjectM,
      };
    }

    /* follow: keep the user's bearing / pitch / zoom, and move the centre AHEAD of the
       object by the offset that cancels the altitude parallax */
    const distanceM = cameraGroundDistanceM(heightPx, pose.lat, input.user.zoom, fovDeg);
    const ahead = followCentreOffsetM({
      altitudeM: pose.alt - ground,
      groundDistanceM: distanceM,
      pitchDeg: input.user.pitch,
      fraction,
      fovDeg,
    });
    return {
      mode: "follow",
      kind: "centre",
      center: offsetLatLng(pose.lat, pose.lon, input.user.bearing, ahead),
      elevation: ground,
      zoom: input.user.zoom,
      pitch: input.user.pitch,
      bearing: input.user.bearing,
      roll: 0,
      distanceM,
    };
  }
}
