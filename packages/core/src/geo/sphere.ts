// src/geo/sphere.ts — great circle helpers (meters, degrees).
import type { LatLng } from "../types";

const R = 6371008.8; // mean earth radius
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const lat1 = a.lat * D2R;
  const lat2 = b.lat * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a -> b in degrees (0..360, clockwise from north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * D2R;
  const lat2 = b.lat * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * R2D) % 360) + 360) % 360;
}

/** Point `distanceMeters` away from `origin` on the given bearing. */
export function destinationPoint(origin: LatLng, bearingDegrees: number, distance: number): LatLng {
  const ang = distance / R;
  const brg = bearingDegrees * D2R;
  const lat1 = origin.lat * D2R;
  const lon1 = origin.lon * D2R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: lat2 * R2D, lon: ((((lon2 * R2D) + 540) % 360) - 180) };
}

/** Circle of `radiusM` around a centre (used for loiter rings, fences, ...). */
export function circle(center: LatLng, radiusM: number, steps = 160): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i <= steps; i++) out.push(destinationPoint(center, (i * 360) / steps, radiusM));
  return out;
}

/** Shortest signed difference between two angles in degrees (-180..180]. */
export function angleDeltaDeg(from: number, to: number): number {
  return (((to - from) % 360) + 540) % 360 - 180;
}

export function normaliseAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
