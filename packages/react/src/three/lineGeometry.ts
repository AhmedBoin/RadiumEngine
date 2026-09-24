// src/three/lineGeometry.ts — shared line sampling for the 3D engine.
//
// Zoom-adaptive Catmull-Rom resampling, distance-based jitter filtering and a
// local scene origin so float32 keeps full precision at deep zoom.
import * as THREE from "three";
import type { LatLngAlt } from "@radium-engine/core";
import { mercatorAt, type SceneOrigin } from "./sceneOrigin";

export type LinePoint = LatLngAlt;
export const ZERO_ORIGIN: SceneOrigin = { x: 0, y: 0, z: 0 };

const MAX_POINTS = 12000;
const DEFAULT_STEPS = 8;
const MAX_STEPS = 64;
const TRACK_SPACING_M = 2.5;
const MAX_TRACK_POINTS = 4000;

/** World positions relative to the local scene origin. */
export function toLocal(points: LinePoint[], origin: SceneOrigin = ZERO_ORIGIN): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const point of points) {
    const merc = mercatorAt(point.lat, point.lon, point.alt ?? 0);
    const local = new THREE.Vector3(merc.x - origin.x, merc.y - origin.y, merc.z - origin.z);
    if (!out.length || out[out.length - 1].distanceToSquared(local) > 1e-24) out.push(local);
  }
  return out;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Resample through a spline, at most `maxChordPx` pixels per chord. */
export function smoothPoints(
  points: THREE.Vector3[],
  unitsPerPixel?: number,
  maxChordPx = 4,
): THREE.Vector3[] {
  if (points.length < 3) return points;
  const out: THREE.Vector3[] = [];
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = at(i + 2);
    const steps =
      unitsPerPixel && unitsPerPixel > 0
        ? Math.min(MAX_STEPS, Math.max(1, Math.ceil(p1.distanceTo(p2) / unitsPerPixel / maxChordPx)))
        : DEFAULT_STEPS;

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(
        new THREE.Vector3(
          catmullRom(p0.x, p1.x, p2.x, p3.x, t),
          catmullRom(p0.y, p1.y, p2.y, p3.y, t),
          catmullRom(p0.z, p1.z, p2.z, p3.z, t),
        ),
      );
      if (out.length >= MAX_POINTS) {
        out.push(points[points.length - 1].clone());
        return out;
      }
    }
  }

  out.push(points[points.length - 1].clone());
  return out;
}

/** Even arc-length resampling so the filter radius is a distance, not a count. */
export function resampleUniform(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  if (spacing <= 0) return points;
  const out = [points[0].clone()];
  let carry = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = a.distanceTo(b);
    if (length <= 1e-18) continue;

    let position = spacing - carry;
    while (position <= length) {
      const t = position / length;
      out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
      position += spacing;
    }
    carry = (carry + length) % spacing;
  }

  out.push(points[points.length - 1].clone());
  return out;
}

/** 1-2-1 filter, horizontal and vertical separately (GPS noise vs baro noise). */
export function denoisePoints(
  points: THREE.Vector3[],
  passesXY = 3,
  passesZ = 4,
): THREE.Vector3[] {
  if (points.length < 3) return points;
  let current = points;

  for (let pass = 0; pass < Math.max(passesXY, passesZ); pass++) {
    const next = current.map((point) => point.clone());
    const horizontal = pass < passesXY;
    const vertical = pass < passesZ;
    for (let i = 1; i < current.length - 1; i++) {
      const a = current[i - 1];
      const b = current[i];
      const c = current[i + 1];
      next[i].set(
        horizontal ? (a.x + 2 * b.x + c.x) / 4 : b.x,
        horizontal ? (a.y + 2 * b.y + c.y) / 4 : b.y,
        vertical ? (a.z + 2 * b.z + c.z) / 4 : b.z,
      );
    }
    current = next;
  }

  return current;
}

/** Metres per mercator world unit at a given mercator y. */
function metresPerUnit(y: number): number {
  const lat = (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
  return Math.max(1, 40075016.686 * Math.cos((lat * Math.PI) / 180));
}

export type SamplingOptions = {
  smooth?: boolean;
  denoise?: boolean;
  unitsPerPixel?: number;
  maxChordPx?: number;
};

/** Convert lat/lng/alt points into flat Float32-friendly positions. */
export function samplePositions(
  points: LinePoint[],
  origin: SceneOrigin,
  options: SamplingOptions = {},
): number[] | null {
  if (points.length < 2) return null;
  let local = toLocal(points, origin);
  if (local.length < 2) return null;

  if (options.denoise) {
    const scale = metresPerUnit(local[0].y);
    let length = 0;
    for (let i = 1; i < local.length; i++) length += local[i].distanceTo(local[i - 1]) * scale;
    const spacingM = Math.max(TRACK_SPACING_M, length / MAX_TRACK_POINTS);
    local = denoisePoints(resampleUniform(local, spacingM / scale));
  }
  if (options.smooth) local = smoothPoints(local, options.unitsPerPixel, options.maxChordPx ?? 4);

  const flat: number[] = [];
  for (const point of local) flat.push(point.x, point.y, point.z);
  return flat.length >= 6 ? flat : null;
}
