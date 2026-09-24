// src/tiles/pipeline.ts — one cache-first tile pipeline for imagery AND terrain.
//
//   key = <folder>/<z>/<x>/<y>
//   get(key)  ->  cache hit? return
//                 else download -> transform (GeoTIFF to terrarium, smoothing)
//                 -> store -> return
//
// In-flight requests are de-duplicated, so panning around never downloads the
// same tile twice, and prefetching uses the very same path (what you prefetch is
// exactly what you read later, offline).
import { folderForProvider, tileKey } from "../cache/paths";
import type { CacheAdapter, CacheEvent } from "../cache/types";
import { resolveTileUrl } from "./resolveUrl";
import type {
  PrefetchOptions,
  PrefetchProgress,
  TileCoord,
  TileEvent,
  TileFetch,
  TileSource,
  TileTransform,
} from "./types";

export type TilePipelineOptions = {
  cache: CacheAdapter;
  /** How to download (browser fetch, Tauri/Rust fetch, a test double, ...). */
  fetchTile?: TileFetch;
  /** Post processors, in order (default: GeoTIFF decode + DEM smoothing). */
  transforms?: TileTransform[];
  onEvent?: (event: TileEvent) => void;
  /** Max simultaneous downloads for `get` and `prefetch` (default 6). */
  concurrency?: number;
};

const defaultFetch: TileFetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.arrayBuffer();
};

export class TilePipeline {
  private readonly cache: CacheAdapter;
  private readonly fetchTile: TileFetch;
  private readonly transforms: TileTransform[];
  private readonly onEvent?: (event: TileEvent) => void;
  /** key -> running download, so parallel requests share one request. */
  private readonly inflight = new Map<string, Promise<ArrayBuffer>>();
  private readonly concurrency: number;

  constructor(options: TilePipelineOptions) {
    this.cache = options.cache;
    this.fetchTile = options.fetchTile ?? defaultFetch;
    this.transforms = options.transforms ?? [];
    this.onEvent = options.onEvent;
    this.concurrency = Math.max(1, options.concurrency ?? 6);
  }

  get adapter(): CacheAdapter {
    return this.cache;
  }

  /** Cache key of a tile of a source. */
  keyFor(source: TileSource, tile: TileCoord): string {
    return tileKey(source.folder ?? folderForProvider(source.id), tile.z, tile.x, tile.y);
  }

  urlFor(source: TileSource, tile: TileCoord): string {
    return resolveTileUrl(source.url, tile.z, tile.x, tile.y, source.subdomains);
  }

  async has(source: TileSource, tile: TileCoord): Promise<boolean> {
    return this.cache.has(this.keyFor(source, tile));
  }

  /** Bytes of one tile: cache first, then download (+transform) and store. */
  async get(source: TileSource, tile: TileCoord, options: { skipCache?: boolean } = {}): Promise<ArrayBuffer> {
    const key = this.keyFor(source, tile);

    if (!options.skipCache) {
      const cached = await this.cache.get(key);
      if (cached) {
        this.onEvent?.({ type: "hit", key });
        return cached;
      }
    }
    this.onEvent?.({ type: "miss", key });

    const running = this.inflight.get(key);
    if (running) return running;

    const job = this.download(source, tile, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async download(source: TileSource, tile: TileCoord, key: string): Promise<ArrayBuffer> {
    const url = this.urlFor(source, tile);
    this.onEvent?.({ type: "download", key, url });

    let bytes = await this.fetchTile(url, tile, source);

    for (const transform of this.transforms) {
      bytes = await transform(bytes, source, tile);
    }

    await this.cache.put(key, bytes);
    this.onEvent?.({ type: "stored", key, bytes: bytes.byteLength });
    return bytes;
  }

  /**
   * Download many tiles (imagery and/or terrain) with a progress callback.
   * Nothing is re-downloaded when it is already cached.
   */
  async prefetch(
    source: TileSource,
    tiles: TileCoord[],
    options: PrefetchOptions = {},
  ): Promise<PrefetchProgress> {
    const progress: PrefetchProgress = {
      done: 0,
      total: tiles.length,
      downloaded: 0,
      cached: 0,
      failed: 0,
      bytes: 0,
    };

    const queue = [...tiles];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length || 1) }, async () => {
      while (queue.length > 0) {
        if (options.signal?.aborted) return;
        const tile = queue.shift();
        if (!tile) return;

        const key = this.keyFor(source, tile);
        try {
          if (!options.refresh && (await this.cache.has(key))) {
            progress.cached++;
          } else {
            const bytes = await this.get(source, tile, { skipCache: true });
            progress.downloaded++;
            progress.bytes += bytes.byteLength;
          }
        } catch (error) {
          progress.failed++;
          this.onEvent?.({ type: "error", key, url: this.urlFor(source, tile), error });
        } finally {
          progress.done++;
          options.onProgress?.(progress);
        }
      }
    });

    await Promise.all(workers);
    return progress;
  }

  /** Cache statistics of the configured adapter. */
  stats() {
    return this.cache.stats();
  }

  /** Emit cache-level events into the same stream (useful for status UI). */
  forwardCacheEvents(): void {
    void this.cache;
  }
}

export type { CacheEvent };
