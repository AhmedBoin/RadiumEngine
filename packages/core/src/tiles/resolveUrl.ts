// src/tiles/resolveUrl.ts — turn a provider template into a real tile URL.
import { lngLatToTile } from "../geo/mercator";
import type { TileCoord } from "./types";

/** Bing-style quadkey for a tile. */
export function toQuadKey(x: number, y: number, z: number): string {
  let quadKey = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadKey += digit;
  }
  return quadKey;
}

/** Deterministic subdomain pick so caching stays stable for a tile. */
function subdomainFor(tile: TileCoord, subdomains?: ReadonlyArray<string | number>) {
  if (!subdomains || subdomains.length === 0) return "";
  const index = Math.abs(tile.x + tile.y) % subdomains.length;
  return String(subdomains[index]);
}

/**
 * Resolve a template. Supported placeholders: {z} {x} {y} {s} (subdomain)
 * {q} (quadkey) and {-y} (TMS, y counted from the south).
 */
export function resolveTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
  subdomains?: ReadonlyArray<string | number>,
): string {
  const tile = { z, x, y };
  return template
    .replace(/\{s\}/g, subdomainFor(tile, subdomains))
    .replace(/\{q\}/g, toQuadKey(x, y, z))
    .replace(/\{-y\}/g, String((1 << z) - 1 - y))
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

/** Tile containing a position (helper for the prefetch API). */
export function tileAt(lat: number, lon: number, z: number): TileCoord {
  const { x, y } = lngLatToTile(lat, lon, z);
  return { z, x, y };
}
