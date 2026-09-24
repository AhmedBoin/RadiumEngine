// src/dem/elevation.ts — ground elevation service shared by both engines.
//
// It answers two different questions, which is what makes 3D terrain look right:
//   at(lat, lon)      real elevation in meters MSL (drops, POI, mission math)
//   surface(lat, lon) the elevation as RENDERED, i.e. multiplied by the terrain
//                     exaggeration that MapLibre draws with, so icons, drop
//                     lines and objects sit exactly on the visible ground.
//
// Tiles come from the shared TilePipeline, so everything here is cache-first and
// works offline once prefetched.
import { lngLatToTile } from "../geo/mercator";
import type { TilePipeline } from "../tiles/pipeline";
import { decodeElevationTile, demDecodeElevation } from "../tiles/transforms/terrarium";
import type { LatLng } from "../types";

export type ElevationOptions = {
  /** Zoom used when sampling the DEM (default 13 ≈ 20 m/px). */
  sampleZoom?: number;
  /** Source of elevation tiles (from `terrainSourceFor`). */
  source: { id: string; url: string; folder: string; encoding?: "terrarium" | "mapbox"; geotiffTiles?: boolean; smoothing?: number; maxZoom?: number };
  /** Decoded tiles kept in memory (default 24). */
  maxTiles?: number;
};

type DecodedTile = { heights: Float32Array; size: number };

export class ElevationService {
  private pipeline: TilePipeline;
  private options: ElevationOptions;
  private decoded = new Map<string, DecodedTile>();
  private points = new Map<string, number>();
  private pending = new Map<string, Promise<number | null>>();
  private listeners = new Set<() => void>();

  constructor(pipeline: TilePipeline, options: ElevationOptions) {
    this.pipeline = pipeline;
    this.options = options;
  }

  /** Switch to another elevation source (clears every cached value). */
  setSource(options: ElevationOptions): void {
    this.options = options;
    this.invalidate();
  }

  get source() {
    return this.options.source;
  }

  invalidate(): void {
    this.decoded.clear();
    this.points.clear();
    this.pending.clear();
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Elevation already known for a position (meters MSL), if any. */
  cached(lat: number, lon: number): number | undefined {
    return this.points.get(pointKey(lat, lon));
  }

  /** Real elevation in meters MSL, decoded from the cache (or downloaded). */
  async at(lat: number, lon: number): Promise<number | null> {
    const key = pointKey(lat, lon);
    const known = this.points.get(key);
    if (known !== undefined) return known;

    const running = this.pending.get(key);
    if (running) return running;

    const job = this.lookup(lat, lon)
      .then((value) => {
        if (value !== null) {
          this.points.set(key, value);
          this.listeners.forEach((listener) => listener());
        }
        return value;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, job);
    return job;
  }

  private async lookup(lat: number, lon: number): Promise<number | null> {
    const zoom = Math.min(this.options.sampleZoom ?? 13, this.options.source.maxZoom ?? 15);
    const tile = lngLatToTile(lat, lon, zoom);
    const decoded = await this.decodeTile(zoom, tile.x, tile.y);
    if (!decoded) return null;

    const px = Math.max(0, Math.min(decoded.size - 1, Math.floor(tile.fx * decoded.size)));
    const py = Math.max(0, Math.min(decoded.size - 1, Math.floor(tile.fy * decoded.size)));
    return decoded.heights[py * decoded.size + px];
  }

  /** Ground as MapLibre DRAWS it (exaggeration included), 0 when unknown. */
  surface(lat: number, lon: number, exaggeration = 1): number {
    const known = this.points.get(pointKey(lat, lon));
    return known === undefined ? 0 : known * exaggeration;
  }

  /** Warm many points at once (one decode per tile, like the tile pipeline). */
  async ensure(points: LatLng[]): Promise<void> {
    const zoom = Math.min(this.options.sampleZoom ?? 13, this.options.source.maxZoom ?? 15);
    const tiles = new Map<string, { z: number; x: number; y: number }>();
    for (const point of points) {
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) continue;
      const { x, y } = lngLatToTile(point.lat, point.lon, zoom);
      tiles.set(`${zoom}/${x}/${y}`, { z: zoom, x, y });
    }
    await Promise.all([...tiles.values()].map((tile) => this.decodeTile(tile.z, tile.x, tile.y)));
    await Promise.all(points.map((point) => this.at(point.lat, point.lon)));
  }

  private async decodeTile(z: number, x: number, y: number): Promise<DecodedTile | null> {
    const key = `${z}/${x}/${y}`;
    const cached = this.decoded.get(key);
    if (cached) {
      /* refresh LRU order */
      this.decoded.delete(key);
      this.decoded.set(key, cached);
      return cached;
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await this.pipeline.get(this.options.source as any, { z, x, y });
    } catch (error) {
      console.warn("[RadiumEngine] elevation tile unavailable", key, error);
      return null;
    }

    const decoded = await decodeElevationTile(bytes, this.options.source.encoding ?? "terrarium");
    if (!decoded) return null;

    this.decoded.set(key, decoded);
    const maxTiles = this.options.maxTiles ?? 24;
    while (this.decoded.size > maxTiles) {
      const oldest = this.decoded.keys().next().value as string | undefined;
      if (!oldest) break;
      this.decoded.delete(oldest);
    }
    return decoded;
  }

  /** Decode one pixel of a raw tile (rarely needed outside the service). */
  static decodePixel(
    encoding: "terrarium" | "mapbox",
    r: number,
    g: number,
    b: number,
  ): number {
    return demDecodeElevation(encoding, r, g, b);
  }
}

const pointKey = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
