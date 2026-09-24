// src/cache/paths.ts — cache layout helpers (shared by every adapter).
//
// Layout:  <root>/<folder>/<z>/<x>/<y>      (no extension: a tile may be PNG,
//                                            JPEG, WebP or GeoTIFF)
import type { CacheKey } from "./types";

/** Provider id -> safe folder name ("ESRI.WorldImagery" -> "ESRI_WorldImagery"). */
export function folderForProvider(id: string): string {
  return (id || "tiles").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\./g, "_");
}

export function tileKey(folder: string, z: number, x: number, y: number): CacheKey {
  return `${folder}/${z}/${x}/${y}`;
}

/** Relative file path of a tile inside the cache root. */
export function tilePath(folder: string, z: number, x: number, y: number): string {
  return `${folder}/${z}/${x}/${y}`;
}

/** Relative directory of a tile inside the cache root. */
export function tileDir(folder: string, z: number, x: number): string {
  return `${folder}/${z}/${x}`;
}

export function parseTileKey(key: CacheKey) {
  const parts = key.split("/");
  if (parts.length < 4) return null;
  const y = Number(parts[parts.length - 1]);
  const x = Number(parts[parts.length - 2]);
  const z = Number(parts[parts.length - 3]);
  const folder = parts.slice(0, parts.length - 3).join("/");
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { folder, z, x, y };
}
