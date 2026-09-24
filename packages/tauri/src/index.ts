// src/index.ts — the JavaScript side of the Rust accelerator.
//
// Everything here is OPTIONAL: when the plugin is not installed (a browser build,
// or a Tauri app without it) every function degrades gracefully and the pure
// TypeScript path keeps working. That is what makes the accelerator safe to add
// to an app that already ships.
import {
  createCache,
  folderForProvider,
  lngLatToTile,
  type CacheAdapter,
  type CacheStats,
  type PrefetchProgress,
  type TileCoord,
} from "@radium-engine/core";

export type TauriPrefetchOptions = {
  /** Provider id used as the cache folder ("ESRI.WorldImagery", "Terrarium"…). */
  sourceId: string;
  urlTemplate: string;
  subdomains?: (string | number)[];
  /** Tiles to download. */
  tiles: TileCoord[];
  /** Parallel downloads (default 16 — the browser is stuck at ~6). */
  concurrency?: number;
  refresh?: boolean;
  onProgress?: (progress: PrefetchProgress) => void;
};

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

let bridge: { invoke: InvokeFn; listen: ListenFn } | null = null;

async function loadBridge(): Promise<{ invoke: InvokeFn; listen: ListenFn } | null> {
  if (bridge) return bridge;
  if (typeof window === "undefined") return null;
  try {
    const core = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as any;
    const event = (await import(/* @vite-ignore */ "@tauri-apps/api/event")) as any;
    bridge = { invoke: core.invoke as InvokeFn, listen: event.listen as ListenFn };
    return bridge;
  } catch {
    return null;
  }
}

/** True when the Rust plugin is available in this app. */
export async function isAcceleratorAvailable(): Promise<boolean> {
  const api = await loadBridge();
  if (!api) return false;
  try {
    await api.invoke("plugin:radium-engine|cache_stats");
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefetch through Rust: much higher parallelism than `fetch`, plus a progress
 * event stream, and the tiles land in exactly the same cache folder layout the
 * TypeScript adapters use.
 */
export async function prefetchTiles(options: TauriPrefetchOptions): Promise<PrefetchProgress> {
  const api = await loadBridge();
  if (!api) throw new Error("RadiumEngine: the Rust accelerator is not available");

  const unlisten = options.onProgress
    ? await api.listen<PrefetchProgress>("radium://progress", (event) => options.onProgress!(event.payload))
    : null;

  try {
    return await api.invoke<PrefetchProgress>("plugin:radium-engine|prefetch_tiles", {
      tiles: options.tiles.map((tile) => ({
        sourceId: options.sourceId,
        urlTemplate: options.urlTemplate,
        subdomains: options.subdomains?.map(String),
        z: tile.z,
        x: tile.x,
        y: tile.y,
      })),
      options: { concurrency: options.concurrency ?? 16, refresh: options.refresh ?? false },
    });
  } finally {
    unlisten?.();
  }
}

/** Entries + bytes on disk, straight from the file system (no HTTP). */
export async function cacheStats(sourceLocation?: string): Promise<CacheStats | null> {
  const api = await loadBridge();
  if (!api) return null;
  try {
    const stats = await api.invoke<{ entries: number; bytes: number; location: string }>(
      "plugin:radium-engine|cache_stats",
    );
    return { adapter: "tauri-rust", entries: stats.entries, bytes: stats.bytes, location: sourceLocation ?? stats.location };
  } catch {
    return null;
  }
}

export async function clearCache(sourceId?: string): Promise<boolean> {
  const api = await loadBridge();
  if (!api) return false;
  try {
    await api.invoke("plugin:radium-engine|clear_cache", { sourceId: sourceId ?? null });
    return true;
  } catch {
    return false;
  }
}

/** Ground elevation of one point, sampled by Rust from the cached DEM tiles. */
export async function sampleElevation(options: {
  sourceId: string;
  lat: number;
  lon: number;
  zoom?: number;
}): Promise<number | null> {
  const api = await loadBridge();
  if (!api) return null;

  const zoom = options.zoom ?? 13;
  const tile = lngLatToTile(options.lat, options.lon, zoom);
  try {
    return await api.invoke<number>("plugin:radium-engine|sample_elevation", {
      sourceId: folderForProvider(options.sourceId),
      z: zoom,
      x: tile.x,
      y: tile.y,
      px: Math.min(255, Math.max(0, Math.floor(tile.fx * 256))),
      py: Math.min(255, Math.max(0, Math.floor(tile.fy * 256))),
    });
  } catch {
    return null;
  }
}

/**
 * A CacheAdapter the rest of RadiumEngine can use directly: reads stay in
 * JavaScript (fs plugin), only bulk work goes to Rust.
 */
export async function createAcceleratedCache(): Promise<CacheAdapter | null> {
  if (!(await isAcceleratorAvailable())) return null;
  return createCache({ kind: "tauri-fs" });
}
