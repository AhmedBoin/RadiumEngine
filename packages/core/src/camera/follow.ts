// src/camera/follow.ts — the filter between "the object's interpolated state" and
// "the camera".
//
// Why a second filter at all: the pose interpolator (`motion/interpolation.ts`)
// already turns bursts of updates into a continuous path, but its output still
// carries sample-level residue — small velocity changes, a dropped message, a
// re-acquired fix. A camera that copies that value every frame shows every bit of it,
// amplified by the zoom (one metre is ~2 px at zoom 17 and ~16 px at zoom 20). The
// filter tracks the value with an alpha-beta (g-h) predictor:
//
//   predict:  p' = p + v·dt
//   correct:  r  = target − p'
//             p  = p' + α·r
//             v  = v  + β·r/dt          with β = α²/(2 − α), the critically damped pair
//
// The properties that make it the right tool:
//   * a *constant velocity* target is tracked with **zero steady-state lag** (the
//     fixed point is the target itself), so following does not drag behind in normal
//     motion — only sudden changes are smoothed;
//   * it is critically damped, so a step never overshoots or rings;
//   * noise is attenuated instead of copied.
//
// Angles use the shortest signed difference, so a turn through north (359° → 1°) does
// not sweep the long way round. Everything is pure and covered by
// `npm run check:camera`, which feeds it a jittery 10 Hz stream and measures the
// residual jerk, the overshoot and the settling time.
import { angleDeltaDeg, normaliseAngle } from "../geo/sphere";
import type { CameraTuning, FollowTarget } from "./types";

export type CameraFollowState = {
  pose: FollowTarget;
  /** filtered rates, per second */
  vLat: number;
  vLon: number;
  vAlt: number;
  vHeading: number;
  vPitch: number;
  vRoll: number;
  /** false until the first target was seeded */
  ready: boolean;
};

const DEFAULT_POSITION_MS = 600;
const DEFAULT_ANGLE_MS = 360;
/** A frame longer than this is treated as this much (a stall must not teleport). */
const MAX_STEP_MS = 120;

/** A fresh state: at the origin and NOT seeded — see `limitFollowTarget`. */
export function createCameraFollow(): CameraFollowState {
  return {
    pose: { lat: 0, lon: 0, alt: 0, heading: 0, pitch: 0, roll: 0 },
    vLat: 0,
    vLon: 0,
    vAlt: 0,
    vHeading: 0,
    vPitch: 0,
    vRoll: 0,
    ready: false,
  };
}

/** Jump the state to a target (no smoothing) — used on the first frame. */
export function seedCameraFollow(state: CameraFollowState, target: FollowTarget): void {
  state.pose = { ...target };
  state.vLat = 0;
  state.vLon = 0;
  state.vAlt = 0;
  state.vHeading = 0;
  state.vPitch = 0;
  state.vRoll = 0;
  state.ready = true;
}

/** Move `value` towards `target` by at most `step` (the rate limit below). */
function approach(value: number, target: number, step: number): number {
  const delta = target - value;
  if (Math.abs(delta) <= step) return target;
  return value + Math.sign(delta) * step;
}

/**
 * Rate limit the follow target: the camera may only be asked to travel
 * `speedLimitMps · dt`, climb `climbLimitMps · dt` and turn `turnLimit · dt` per
 * frame. This is what turns "the position jumped 500 m" into a smooth catch-up
 * instead of a jump — the target itself is limited, so the filter downstream never
 * sees a step.
 *
 * `previous` is the pose the limit is measured FROM, and it may be `null` when the
 * follow state has not been seeded yet. That case matters: a fresh state sits at
 * (0, 0), and limiting from there produces a target a few metres from the Gulf of
 * Guinea, which the filter then *seeds* from — leaving the camera crawling towards
 * the object at the speed limit (thousands of kilometres ⇒ hours, i.e. "the view
 * moved to 0,0 and never arrived"). A caller with no previous pose therefore gets an
 * unlimited target: the first frame is meant to place the camera, not to glide to it.
 */
export function limitFollowTarget(
  previous: FollowTarget | null,
  target: FollowTarget,
  dtMs: number,
  tuning: CameraTuning = {},
): FollowTarget {
  if (!previous) return { ...target };
  const dt = Math.max(0, Math.min(MAX_STEP_MS, Number.isFinite(dtMs) ? dtMs : 0)) / 1000;
  if (dt <= 0) return { ...target };

  const speedLimit = Number.isFinite(tuning.speedLimitMps) ? (tuning.speedLimitMps as number) : 0;
  const climbLimit = Number.isFinite(tuning.climbLimitMps)
    ? (tuning.climbLimitMps as number)
    : speedLimit * 0.5;
  const turnLimit = Number.isFinite(tuning.turnLimitDegPerSec)
    ? (tuning.turnLimitDegPerSec as number)
    : 90;

  /* degrees -> metres, at the latitude we are at (the longitude axis is the more
     demanding one, so the limit is never exceeded in either direction) */
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLon =
    metresPerDegreeLat * Math.max(0.05, Math.cos((previous.lat * Math.PI) / 180));

  const limited: FollowTarget = { ...target };
  if (speedLimit > 0) {
    const step = speedLimit * dt;
    limited.lat = approach(previous.lat, target.lat, step / metresPerDegreeLat);
    limited.lon = approach(previous.lon, target.lon, step / metresPerDegreeLon);
  }
  const climbStep = (climbLimit > 0 ? climbLimit : speedLimit * 0.5) * dt;
  if (climbStep > 0) limited.alt = approach(previous.alt, target.alt, climbStep);
  if (turnLimit > 0) {
    const step = turnLimit * dt;
    limited.heading = normaliseAngle(
      previous.heading +
        Math.max(-step, Math.min(step, angleDeltaDeg(previous.heading, target.heading))),
    );
    limited.pitch = approach(previous.pitch, target.pitch, step);
    limited.roll = approach(previous.roll, target.roll, step);
  }
  return limited;
}

/** alpha/beta for a given response time, critically damped in continuous time. */
function alphaBeta(dt: number, responseMs: number): { alpha: number; beta: number } {
  const tau = Math.max(
    0.0001,
    (Number.isFinite(responseMs) ? responseMs : DEFAULT_POSITION_MS) / 1000,
  );
  const alpha = 1 - Math.exp(-dt / tau);
  return { alpha, beta: (alpha * alpha) / (2 - alpha) };
}

/**
 * Advance one channel. The alpha-beta pair is exactly critically damped in continuous
 * time, but in discrete time the *prediction* can land beyond the target and the
 * correction then keeps it there (a measured 13 % overshoot — `check:camera` is how
 * that was found). A camera has no reason to pass the thing it follows, so the value
 * is pinned to the near side of the target, measured from the previous value: that
 * gives an exact "no overshoot" guarantee while leaving the zero-lag property
 * untouched (when the target moves away, the guard never engages).
 */
function advanceChannel(
  previous: number,
  predicted: number,
  residual: number,
  alpha: number,
  beta: number,
  dt: number,
): { value: number; dv: number } {
  const raw = predicted + alpha * residual;
  const target = predicted + residual;
  const low = Math.min(previous, target);
  const high = Math.max(previous, target);
  return { value: Math.min(Math.max(raw, low), high), dv: (beta * residual) / dt };
}

/**
 * Advance one frame towards `target`. `dtMs` is the real frame time; the state is
 * updated in place and the resulting pose is also returned. The first call seeds the
 * state, so a fresh camera never glides in from the origin.
 */
export function stepCameraFollow(
  state: CameraFollowState,
  target: FollowTarget,
  dtMs: number,
  tuning: CameraTuning = {},
): FollowTarget {
  if (!state.ready) {
    seedCameraFollow(state, limitFollowTarget(null, target, dtMs, tuning));
    return state.pose;
  }
  if (!Number.isFinite(dtMs) || dtMs <= 0) return state.pose;

  const dt = Math.min(MAX_STEP_MS, dtMs) / 1000;
  const position = alphaBeta(dt, tuning.positionMs ?? DEFAULT_POSITION_MS);
  const angle = alphaBeta(dt, tuning.angleMs ?? DEFAULT_ANGLE_MS);
  const pose = state.pose;

  const predictedLat = pose.lat + state.vLat * dt;
  const predictedLng = pose.lon + state.vLon * dt;
  const predictedAlt = pose.alt + state.vAlt * dt;
  const rLat = target.lat - predictedLat;
  const rLng = target.lon - predictedLng;
  const rAlt = target.alt - predictedAlt;

  if (Number.isFinite(rLat) && Number.isFinite(rLng) && Number.isFinite(rAlt)) {
    const lat = advanceChannel(pose.lat, predictedLat, rLat, position.alpha, position.beta, dt);
    const lng = advanceChannel(pose.lon, predictedLng, rLng, position.alpha, position.beta, dt);
    const alt = advanceChannel(pose.alt, predictedAlt, rAlt, position.alpha, position.beta, dt);
    pose.lat = lat.value;
    pose.lon = lng.value;
    pose.alt = alt.value;
    state.vLat += lat.dv;
    state.vLon += lng.dv;
    state.vAlt += alt.dv;
  }

  const predictedHeading = pose.heading + state.vHeading * dt;
  const predictedPitch = pose.pitch + state.vPitch * dt;
  const predictedRoll = pose.roll + state.vRoll * dt;
  const rHeading = angleDeltaDeg(predictedHeading, target.heading);
  const rPitch = target.pitch - predictedPitch;
  const rRoll = target.roll - predictedRoll;

  if (Number.isFinite(rHeading)) {
    const heading = advanceChannel(
      pose.heading,
      predictedHeading,
      rHeading,
      angle.alpha,
      angle.beta,
      dt,
    );
    pose.heading = normaliseAngle(heading.value);
    state.vHeading += heading.dv;
  }
  if (Number.isFinite(rPitch)) {
    const pitch = advanceChannel(pose.pitch, predictedPitch, rPitch, angle.alpha, angle.beta, dt);
    pose.pitch = pitch.value;
    state.vPitch += pitch.dv;
  }
  if (Number.isFinite(rRoll)) {
    const roll = advanceChannel(pose.roll, predictedRoll, rRoll, angle.alpha, angle.beta, dt);
    pose.roll = roll.value;
    state.vRoll += roll.dv;
  }

  return pose;
}
