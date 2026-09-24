// src/geo/mercator.ts — Web Mercator helpers shared by both engines.
//
// MapLibre works in a NORMALISED mercator square: x/y in [0, 1] for the whole
// world, y growing southwards, and 512 * 2^zoom screen pixels per world unit.
// Everything in RadiumEngine uses those same numbers, so 2D (Leaflet) and 3D
// (MapLibre + three.js) can share geometry, tile math and caches.
import type { LatLng, LatLngAlt } from "../types";

/** World size in pixels at zoom 0 (the Slippy-map convention both engines use). */
export const TILE_SIZE = 256;
export const WORLD_PX_AT_Z0 = 512;

export type MercatorPoint = { x: number; y: number; z: number };

/** Mean earth circumference used by MapLibre for altitude -> z. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

/**
 * Altitude (meters MSL) -> normalised mercator z, exactly like MapLibre does it
 * (the cosine factor is what keeps 3D objects aligned with the rendered terrain
 * at high latitudes).
 */
export function mercatorZfromAltitude(alt: number, lat: number): number {
  return alt / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180));
}

/** Inverse of `mercatorZfromAltitude`. */
export function altitudeFromMercatorZ(z: number, lat: number): number {
  return z * Math.cos((lat * Math.PI) / 180) * EARTH_CIRCUMFERENCE;
}

/** Longitude/latitude (degrees) + altitude (meters) -> normalised mercator. */
export function mercatorAt(lat: number, lon: number, alt = 0): MercatorPoint {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const z = alt ? mercatorZfromAltitude(alt, lat) : 0;
  return { x, y, z };
}

/** Inverse of the y part: normalised mercator y -> latitude in degrees. */
export function mercatorYToLat(y: number): number {
  return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
}

/** Latitude (degrees) -> normalised mercator y. */
export function latToMercatorY(lat: number): number {
  return mercatorAt(lat, 0).y;
}

/** Mercator world units per screen pixel at a zoom level. */
export function unitsPerPixel(zoom: number): number {
  return 1 / (WORLD_PX_AT_Z0 * Math.pow(2, zoom));
}

/**
 * Approximate meters per screen pixel in Web Mercator (good enough for
 * screen-space clearances, drop lines and icon sizing).
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Which tile (and where inside it) contains a position. */
export function lngLatToTile(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const m = mercatorAt(lat, lon);
  const fx = m.x * n;
  const fy = m.y * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return { x, y, fx: fx - x, fy: fy - y };
}

/** Geographic bounds of a tile. */
export function tileBounds(z: number, x: number, y: number) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = mercatorYToLat(y / n);
  const south = mercatorYToLat((y + 1) / n);
  return { west, east, north, south };
}

/** All the tiles a bounding box needs for a zoom range (for prefetching). */
export function tilesForBounds(
  bounds: { west: number; south: number; east: number; north: number },
  minZoom: number,
  maxZoom: number,
  limit = 200_000,
) {
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const first = lngLatToTile(bounds.north, bounds.west, z);
    const last = lngLatToTile(bounds.south, bounds.east, z);
    for (let x = Math.max(0, first.x); x <= Math.min(n - 1, last.x); x++) {
      for (let y = Math.max(0, first.y); y <= Math.min(n - 1, last.y); y++) {
        tiles.push({ z, x, y });
        if (tiles.length >= limit) return tiles;
      }
    }
  }
  return tiles;
}

/** Normalised mercator -> lat/lon (inverse of `mercatorAt`). */
export function latLngFromMercator(x: number, y: number, z = 0): LatLngAlt {
  const lat = mercatorYToLat(y);
  return {
    lat,
    lon: x * 360 - 180,
    alt: z ? altitudeFromMercatorZ(z, lat) : 0,
  };
}

export function isLatLng(value: unknown): value is LatLng {
  const v = value as LatLng | undefined;
  return !!v && Number.isFinite(v.lat) && Number.isFinite(v.lon);
}
