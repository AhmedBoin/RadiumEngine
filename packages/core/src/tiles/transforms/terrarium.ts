// src/tiles/transforms/terrarium.ts — elevation packing + terrain smoothing.
import type { DemEncoding } from "../../providers/terrain";
import type { TileSource, TileTransform } from "../types";

/** Decode one pixel of an elevation tile into meters above mean sea level. */
export function demDecodeElevation(encoding: DemEncoding, r: number, g: number, b: number): number {
  if (encoding === "mapbox") return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
  return r * 256 + g + b / 256 - 32768;
}

/** Encode meters above mean sea level into the terrarium R/G/B triplet. */
export function demEncodeTerrarium(height: number): [number, number, number] {
  const v = Math.max(0, Math.min(16777215, Math.round((height + 32768) * 256)));
  return [Math.floor(v / 65536) & 0xff, Math.floor(v / 256) & 0xff, v & 0xff];
}

/** Values outside this range are junk; 3DEP uses -9999 for voids. */
export const MIN_DEM_ELEVATION = -1200;
export const MAX_DEM_ELEVATION = 9000;

export function clampElevation(value: number): number {
  if (!Number.isFinite(value) || value <= MIN_DEM_ELEVATION) return 0;
  return Math.max(MIN_DEM_ELEVATION, Math.min(MAX_DEM_ELEVATION, value));
}

/**
 * Binomial (1-2-1) blur of a height grid, `passes` times, separable and
 * edge-clamped. Removes the SRTM speckle that makes flat ground look bumpy
 * without flattening real slopes.
 */
export function smoothHeights(
  heights: Float32Array,
  passes: number,
  size = 256,
): Float32Array {
  let current = heights;

  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(current.length);
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const a = current[row + Math.max(0, x - 1)];
        const b = current[row + x];
        const c = current[row + Math.min(size - 1, x + 1)];
        horizontal[row + x] = (a + 2 * b + c) / 4;
      }
    }
    const out = new Float32Array(current.length);
    for (let y = 0; y < size; y++) {
      const up = Math.max(0, y - 1) * size;
      const row = y * size;
      const down = Math.min(size - 1, y + 1) * size;
      for (let x = 0; x < size; x++) {
        out[row + x] = (horizontal[up + x] + 2 * horizontal[row + x] + horizontal[down + x]) / 4;
      }
    }
    current = out;
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* PNG <-> height grid (browser only: uses canvas)                     */
/* ------------------------------------------------------------------ */

export function canDecodeImages(): boolean {
  return typeof createImageBitmap === "function" && typeof document !== "undefined";
}

let sharedCanvas: HTMLCanvasElement | null = null;

function canvasContext(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!sharedCanvas) sharedCanvas = document.createElement("canvas");
  sharedCanvas.width = size;
  sharedCanvas.height = size;
  return sharedCanvas.getContext("2d", { willReadFrequently: true });
}

/** Decode a terrarium/terrain-RGB PNG tile into heights (meters MSL). */
export async function decodeElevationTile(
  bytes: ArrayBuffer,
  encoding: DemEncoding = "terrarium",
): Promise<{ heights: Float32Array; size: number } | null> {
  if (!canDecodeImages()) return null;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const size = bitmap.width;
  const ctx = canvasContext(size);
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, size, size);
  bitmap.close?.();

  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = demDecodeElevation(encoding, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  return { heights, size };
}

/** Encode heights as a terrarium PNG tile. */
export async function encodeTerrariumTile(heights: Float32Array, size = 256): Promise<ArrayBuffer> {
  const ctx = canvasContext(size);
  if (!ctx) throw new Error("[RadiumEngine] cannot encode PNG without a DOM canvas");

  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = demEncodeTerrarium(clampElevation(heights[i] ?? 0));
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const canvas = sharedCanvas!;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), "image/png"),
  );
  if (!blob) throw new Error("[RadiumEngine] PNG encode failed");
  return blob.arrayBuffer();
}

/**
 * The transform that implements the "Terrain smoothing" setting: it decodes the
 * elevation tile, blurs it and re-encodes it as terrarium, so the *cached* tile
 * is already clean (and prefetch gets the same data as the live map).
 */
export const demSmoothingTransform: TileTransform = async (bytes, source) => {
  const passes = Math.max(0, Math.min(3, Math.round(source.smoothing ?? 0)));
  if (passes === 0) return bytes;

  const decoded = await decodeElevationTile(bytes, source.encoding ?? "terrarium");
  if (!decoded) return bytes;
  const smoothed = smoothHeights(decoded.heights, passes, decoded.size);
  return encodeTerrariumTile(smoothed, decoded.size);
};

/** Convenience: is this source an elevation source that needs work? */
export function isDemSource(source: TileSource): boolean {
  return source.encoding !== undefined || source.geotiffTiles === true;
}
