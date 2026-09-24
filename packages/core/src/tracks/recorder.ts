// src/tracks/recorder.ts — recorded movement tracks with time/length limits.
//
// A track is the history of where an object has been. It can be limited by time
// (last N seconds), by length (last N meters) or by a hard point count, and it
// can be simplified (Douglas-Peucker) so a noisy GPS feed does not turn into a
// zig-zag when the map is zoomed in.
import { distanceMeters } from "../geo/sphere";
import type { LatLngAlt, TrackOptions, TrackStyle } from "../types";
import { now } from "../motion/interpolation";

export type TrackPoint = { lat: number; lon: number; alt: number; t: number };

export class TrackRecorder {
  private options: TrackOptions;
  private points: TrackPoint[] = [];
  private simplified: TrackPoint[] | null = null;
  /** Cumulative length in meters (kept incrementally). */
  private total = 0;

  constructor(options: TrackOptions) {
    this.options = options;
  }

  get id(): string {
    return this.options.id;
  }

  get style(): TrackStyle | undefined {
    return this.options.style;
  }

  setOptions(options: Partial<TrackOptions>): void {
    this.options = { ...this.options, ...options };
    this.simplified = null;
    this.trim();
  }

  setStyle(style: TrackStyle | undefined): void {
    this.options = { ...this.options, style };
  }

  /** Append a position (call once per received message). */
  push(position: LatLngAlt, time = now()): void {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (Math.abs(last.lat - position.lat) < 1e-9 && Math.abs(last.lon - position.lon) < 1e-9) {
        /* same spot: keep the newest altitude, do not grow the track */
        last.alt = position.alt;
        last.t = time;
        return;
      }
      this.total += distanceMeters(last, position);
    }

    this.points.push({ lat: position.lat, lon: position.lon, alt: position.alt, t: time });
    this.simplified = null;
    this.trim();
  }

  /** Recorded points (simplified when `simplifyM` is set). */
  getPoints(): TrackPoint[] {
    if (!this.options.simplifyM || this.options.simplifyM <= 0) return this.points;
    if (!this.simplified) {
      const tolerance = this.options.simplifyM;
      this.simplified = simplifyPath(this.points, tolerance, (a, b) => distanceMeters(a, b));
    }
    return this.simplified;
  }

  get count(): number {
    return this.points.length;
  }

  /** Length of the recorded path in meters. */
  get lengthMeters(): number {
    return this.total;
  }

  /** Duration of the recorded path in milliseconds. */
  get durationMs(): number {
    if (this.points.length < 2) return 0;
    return this.points[this.points.length - 1].t - this.points[0].t;
  }

  clear(): void {
    this.points = [];
    this.simplified = null;
    this.total = 0;
  }

  /** Apply the time / length / count limits. */
  private trim(): void {
    const { maxSeconds, maxMetres, maxPoints } = this.options;

    if (maxSeconds && this.points.length > 1) {
      const cutoff = this.points[this.points.length - 1].t - maxSeconds * 1000;
      let drop = 0;
      while (drop < this.points.length - 2 && this.points[drop].t < cutoff) drop++;
      if (drop > 0) this.dropFirst(drop);
    }

    if (maxMetres && this.points.length > 1) {
      let length = this.total;
      let drop = 0;
      while (drop < this.points.length - 2 && length > maxMetres) {
        length -= distanceMeters(this.points[drop], this.points[drop + 1]);
        drop++;
      }
      if (drop > 0) this.dropFirst(drop);
    }

    if (maxPoints && this.points.length > maxPoints) {
      this.dropFirst(this.points.length - maxPoints);
    }
  }

  private dropFirst(count: number): void {
    let removed = 0;
    for (let i = 0; i < count - 1 && i + 1 < this.points.length; i++) {
      removed += distanceMeters(this.points[i], this.points[i + 1]);
    }
    this.points.splice(0, count);
    this.total = Math.max(0, this.total - removed);
    this.simplified = null;
  }
}

/**
 * Douglas-Peucker simplification of a path of points (keeps the shape, drops the
 * points that are within `toleranceM` of the line through their neighbours).
 */
export function simplifyPath<T extends { lat: number; lon: number }>(
  points: T[],
  toleranceM: number,
  measure: (a: T, b: T) => number,
): T[] {
  if (points.length < 3 || toleranceM <= 0) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    let maxDistance = 0;
    let index = -1;
    const a = points[first];
    const b = points[last];
    const segmentLength = measure(a, b) || 1e-6;

    for (let i = first + 1; i < last; i++) {
      const point = points[i];
      /* perpendicular distance approximated with the two legs + the segment */
      const d1 = measure(a, point);
      const d2 = measure(point, b);
      const spill = Math.max(0, (d1 + d2 - segmentLength) / 2);
      const distance = Math.min(d1, d2, spill || Math.min(d1, d2));
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}
