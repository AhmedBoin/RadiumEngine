// src/three/sceneOrigin.ts — keeps float32 precision at deep zoom.
//
// MapLibre normalises the whole world to ONE mercator unit, so an absolute
// coordinate near 0.9 only resolves to ±6e-8 (≈±16 px at zoom 19). The cure is
// the classic one: store every vertex relative to a LOCAL ORIGIN close to the
// camera and fold that origin back into the projection matrix in float64.
import * as THREE from "three";
import type { Map as MapLibreMap } from "maplibre-gl";

export type SceneOrigin = { x: number; y: number; z: number };

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

/** Latitude/longitude + altitude in metres -> normalised mercator (MapLibre's). */
export function mercatorAt(lat: number, lon: number, alt = 0): SceneOrigin {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const z = alt ? alt / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) : 0;
  return { x, y, z };
}

/** Normalised mercator y -> latitude in degrees. */
export function mercatorYToLat(y: number): number {
  return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
}

/** Mercator world units per screen pixel at a zoom level. */
export function unitsPerPixel(zoom: number): number {
  return 1 / (512 * Math.pow(2, zoom));
}

/** The map centre is the ideal origin: whatever is on screen stays close to it. */
export function originAtMapCenter(map: MapLibreMap): SceneOrigin {
  const center = map.getCenter();
  return mercatorAt(center.lat, center.lng, 0);
}

/** How far the view centre drifted from an origin, in screen pixels. */
export function originDriftPx(origin: SceneOrigin, map: MapLibreMap): number {
  const center = originAtMapCenter(map);
  const worldSize = 512 * Math.pow(2, map.getZoom());
  return Math.hypot(center.x - origin.x, center.y - origin.y) * worldSize;
}

export const REORIGIN_DRIFT_PX = 4096;

const translation = new THREE.Matrix4();

/**
 * `clip = mainMatrix * (local + origin)`: the origin is folded into the
 * projection matrix here, in float64, instead of letting the GPU add two large
 * float32 numbers.
 */
export function applyRecenteredProjection(
  projection: THREE.Matrix4,
  mainMatrix: ArrayLike<number>,
  origin: SceneOrigin,
): THREE.Matrix4 {
  projection.fromArray(mainMatrix as any);
  translation.makeTranslation(origin.x, origin.y, origin.z);
  return projection.multiply(translation);
}

/** Depth (clip space w) of an absolute mercator position — used for sizing. */
export function clipDepth(mainMatrix: ArrayLike<number>, x: number, y: number, z: number): number {
  return mainMatrix[3] * x + mainMatrix[7] * y + mainMatrix[11] * z + mainMatrix[15];
}
