// src/tools/measure.ts — the arithmetic every map app needs and nobody wants to write.
//
// Everything is spherical (a great circle is not a straight line on a map, and at city
// scale the difference is already metres). Formatters return human units, because
// "1423.4771 m" is what makes a UI look like a debugging tool.
import { bearingDeg, distanceMeters } from "../geo/sphere";
import type { LatLng } from "../types";

/** Length of a path, in metres. */
export function pathLengthM(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/** Length of a closed ring, in metres (the closing edge is included). */
export function perimeterM(points: LatLng[]): number {
  if (points.length < 2) return 0;
  return pathLengthM([...points, points[0]]);
}

/**
 * Area of a polygon on the sphere, in square metres.
 *
 * The spherical excess of the polygon (the standard GIS formula), not a planar
 * approximation: that keeps a region at high latitude — or one spanning many degrees —
 * honest, and it is what a "how big is this field" readout should reflect.
 */
export function polygonAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    /* the longitude difference must be the SHORT way round, or a polygon crossing the
       antimeridian reports its complement */
    let dLon = (b.lon - a.lon) * toRad;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    if (dLon < -Math.PI) dLon += 2 * Math.PI;
    total += dLon * (2 + Math.sin(a.lat * toRad) + Math.sin(b.lat * toRad));
  }
  return Math.abs((total * R * R) / 2);
}

/** The mean of a set of positions (good enough for a label anchor or a centroid). */
export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const point of points) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}

/** The initial bearing from the first point to the last, in degrees. */
export function bearingAlong(points: LatLng[]): number | null {
  if (points.length < 2) return null;
  return bearingDeg(points[0], points[points.length - 1]);
}

/** "540 m" / "1.42 km" */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  const value = Math.abs(metres);
  if (value < 1000) return `${value < 10 ? value.toFixed(1) : Math.round(value)} m`;
  if (value < 100000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value / 1000)} km`;
}

/** "860 m2" / "1.4 ha" / "12.3 km2" */
export function formatArea(squareMetres: number): string {
  if (!Number.isFinite(squareMetres)) return "—";
  const value = Math.abs(squareMetres);
  if (value < 10000) return `${Math.round(value)} m2`;
  if (value < 1000000) return `${(value / 10000).toFixed(2)} ha`;
  return `${(value / 1000000).toFixed(2)} km2`;
}