// src/two/tileLayer.ts — Leaflet tile layer that reads through RadiumEngine's
// tile pipeline (cache first, then download/transform/store). What you prefetched
// is exactly what you see offline.
import type { ImageryProvider, TilePipeline } from "@radium-engine/core";
import L from "leaflet";

export type CachedTileLayerOptions = {
  pipeline: TilePipeline;
  provider: ImageryProvider;
  /** Tile size in CSS px (256 normally, 128 for "HD" mode). */
  tileSize?: number;
  /** Extra zoom applied to the tile requests (HD mode uses -1). */
  zoomOffset?: number;
  maxNativeZoom?: number;
  opacity?: number;
  attribution?: string;
};

/**
 * A Leaflet tile layer whose `createTile` resolves every tile through the
 * pipeline: cache hit -> immediate, miss -> download + transform + store.
 */
export function createCachedTileLayer(options: CachedTileLayerOptions): L.TileLayer {
  const { pipeline, provider } = options;
  const tileSize = options.tileSize ?? provider.tileSize ?? 256;
  const zoomOffset = options.zoomOffset ?? 0;
  const providerFolder = provider.id;

  const layer = new L.TileLayer("", {
    tileSize,
    zoomOffset,
    minZoom: 0,
    maxZoom: 24,
    maxNativeZoom: options.maxNativeZoom ?? provider.maxZoom ?? 19,
    attribution: options.attribution ?? provider.attribution ?? "",
    opacity: options.opacity ?? 1,
    crossOrigin: true,
    keepBuffer: 4,
  });

  /* one source descriptor per provider: the pipeline caches by folder */
  const source = {
    id: providerFolder,
    url: provider.url,
    subdomains: provider.subdomains,
    tileSize,
    maxZoom: provider.maxZoom ?? 19,
  };

  // @ts-expect-error Leaflet types do not describe the tile factory contract
  layer.createTile = (coords: { x: number; y: number; z: number }, done: (error: Error | null, tile: HTMLImageElement) => void) => {
    const tile = document.createElement("img");
    tile.width = tileSize;
    tile.height = tileSize;
    tile.alt = "";
    tile.setAttribute("role", "presentation");
    tile.crossOrigin = "anonymous";

    const request = { z: Math.max(0, coords.z), x: coords.x, y: coords.y };

    void pipeline
      .get(source, request)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes]));
        tile.onload = () => {
          URL.revokeObjectURL(url);
          done(null, tile);
        };
        tile.onerror = () => done(new Error("tile decode failed"), tile);
        tile.src = url;
      })
      .catch((error) => {
        /* last resort: let the browser fetch it directly */
        tile.onload = () => done(null, tile);
        tile.onerror = () => done(error instanceof Error ? error : new Error(String(error)), tile);
        tile.src = pipeline.urlFor(source, request);
      });

    return tile;
  };

  return layer;
}
