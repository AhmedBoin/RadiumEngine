// src/motion/interpolation.ts — "jump" or "smooth" movement for any Pose6.
//
// Feeds arrive in bursts while the map renders ~60 frames per second. Two modes
// cover every use case:
//
//   jump    draw exactly what was received (deterministic, instant)
//   smooth  keep a short timestamped history and render it `lagMs` behind the
//           newest pose, interpolating with Catmull-Rom and extrapolating with
//           the last velocity when the buffer runs dry, so the object keeps
//           gliding instead of stepping.
//
// The same class serves both engines, so 2D and 3D always show identical motion.
import { angleDeltaDeg, normaliseAngle } from "../geo/sphere";
import type { MotionOptions, Pose6 } from "../types";

type Sample = { t: number; pose: Pose6 };

const DEFAULTS = { mode: "smooth" as const, lagMs: 280, maxExtrapolationMs: 2000 };
const MAX_SAMPLES = 32;
const MAX_AGE_MS = 8000;

/** Frame clock: `performance.now()` when available (browser/worker). */
export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Interpolates the pose of ONE moving object. */
export class PoseInterpolator {
  private options: Required<MotionOptions>;
  private samples: Sample[] = [];
  private velocity = { lat: 0, lon: 0, alt: 0 };

  constructor(options: MotionOptions = {}) {
    this.options = {
      mode: options.mode ?? DEFAULTS.mode,
      lagMs: options.lagMs ?? DEFAULTS.lagMs,
      maxExtrapolationMs: options.maxExtrapolationMs ?? DEFAULTS.maxExtrapolationMs,
    };
  }

  configure(options: MotionOptions): void {
    this.options = {
      mode: options.mode ?? this.options.mode,
      lagMs: options.lagMs ?? this.options.lagMs,
      maxExtrapolationMs: options.maxExtrapolationMs ?? this.options.maxExtrapolationMs,
    };
  }

  get mode() {
    return this.options.mode;
  }

  get lastPose(): Pose6 | null {
    return this.samples.length ? this.samples[this.samples.length - 1].pose : null;
  }

  /** Feed a new pose (call once per received message). */
  push(pose: Pose6, time = now()): void {
    const previous = this.samples[this.samples.length - 1];
    if (previous) {
      const dt = time - previous.t;
      if (dt > 0) {
        this.velocity = {
          lat: (pose.lat - previous.pose.lat) / dt,
          lon: (pose.lon - previous.pose.lon) / dt,
          alt: (pose.alt - previous.pose.alt) / dt,
        };
      }
    }

    this.samples.push({ t: time, pose });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    this.samples = this.samples.filter((sample) => time - sample.t <= MAX_AGE_MS);
  }

  clear(): void {
    this.samples = [];
    this.velocity = { lat: 0, lon: 0, alt: 0 };
  }

  /** Pose to draw right now (null when nothing was fed yet). */
  sample(time = now()): Pose6 | null {
    if (this.samples.length === 0) return null;
    if (this.options.mode === "jump") return this.samples[this.samples.length - 1].pose;
    return this.valueAt(time - this.options.lagMs);
  }

  /** True while the buffer is still animating (engines keep repainting). */
  get active(): boolean {
    if (this.samples.length === 0) return false;
    return now() - this.samples[this.samples.length - 1].t < 1000;
  }

  private valueAt(time: number): Pose6 {
    const samples = this.samples;
    if (samples.length === 1) return samples[0].pose;

    const newest = samples[samples.length - 1];
    if (time >= newest.t) {
      const gap = Math.min(time - newest.t, this.options.maxExtrapolationMs);
      return {
        lat: newest.pose.lat + this.velocity.lat * gap,
        lon: newest.pose.lon + this.velocity.lon * gap,
        alt: newest.pose.alt + this.velocity.alt * gap,
        roll: newest.pose.roll,
        pitch: newest.pose.pitch,
        yaw: newest.pose.yaw,
      };
    }

    let index = 0;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].t <= time) {
        index = i;
        break;
      }
    }

    const p1 = samples[index];
    const p2 = samples[Math.min(samples.length - 1, index + 1)];
    if (p1 === p2) return p1.pose;

    const span = p2.t - p1.t;
    const t = span > 0 ? Math.min(1, Math.max(0, (time - p1.t) / span)) : 1;
    const p0 = samples[Math.max(0, index - 1)];
    const p3 = samples[Math.min(samples.length - 1, index + 2)];

    /* yaw is unwrapped before curving so 359° -> 1° stays a short turn */
    const y1 = p1.pose.yaw;
    const y2 = y1 + angleDeltaDeg(y1, p2.pose.yaw);
    const y0 = y2 + angleDeltaDeg(y2, p0.pose.yaw);
    const y3 = y1 + angleDeltaDeg(y1, p3.pose.yaw);

    return {
      lat: catmullRom(p0.pose.lat, p1.pose.lat, p2.pose.lat, p3.pose.lat, t),
      lon: catmullRom(p0.pose.lon, p1.pose.lon, p2.pose.lon, p3.pose.lon, t),
      alt: catmullRom(p0.pose.alt, p1.pose.alt, p2.pose.alt, p3.pose.alt, t),
      roll: catmullRom(p0.pose.roll, p1.pose.roll, p2.pose.roll, p3.pose.roll, t),
      pitch: catmullRom(p0.pose.pitch, p1.pose.pitch, p2.pose.pitch, p3.pose.pitch, t),
      yaw: normaliseAngle(catmullRom(y0, y1, y2, y3, t)),
    };
  }
}
