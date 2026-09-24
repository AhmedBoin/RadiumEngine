// src/tiles/types.ts — what a "tile source" is and how tiles are fetched.
import type { DemEncoding } from "../providers/terrain";

export type TileCoord = { z: number; x: number; y: number };

/**
 * The minimum a tile source must describe. Imagery providers, terrain providers
 * and ad-hoc sources all satisfy this, which is why one pipeline serves them all.
 */
export type TileSource = {
  id: string;
  /** URL template with {z} {x} {y} ({s} subdomain, {q} quadkey, {-y} TMS). */
  url: string;
  /** Cache folder; defaults to a sanitised provider id. */
  folder?: string;
  subdomains?: ReadonlyArray<string | number>;
  tileSize?: number;
  maxZoom?: number;
  /** Elevation sources only. */
  encoding?: DemEncoding;
  geotiffTiles?: boolean;
  smoothing?: number;
  local?: boolean;
};

/** Tile bytes are post-processed by these (GeoTIFF decode, terrain smoothing). */
export type TileTransform = (
  bytes: ArrayBuffer,
  source: TileSource,
  tile: TileCoord,
) => Promise<ArrayBuffer>;

export type TileFetch = (url: string, tile: TileCoord, source: TileSource) => Promise<ArrayBuffer>;

export type TileEvent =
  | { type: "hit"; key: string }
  | { type: "miss"; key: string }
  | { type: "download"; key: string; url: string }
  | { type: "stored"; key: string; bytes: number }
  | { type: "error"; key: string; url?: string; error: unknown };

export type PrefetchProgress = {
  done: number;
  total: number;
  downloaded: number;
  cached: number;
  failed: number;
  bytes: number;
};

export type PrefetchOptions = {
  /** Max simultaneous downloads (default 6). */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: PrefetchProgress) => void;
  /** Skip tiles already in the cache without asking the cache adapter again. */
  refresh?: boolean;
};
