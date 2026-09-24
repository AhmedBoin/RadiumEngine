// src/tiles/transforms/geotiff.ts — remote GeoTIFF elevation tiles -> terrarium.
//
// Free bare-earth DEMs (USGS 3DEP on AWS Open Data) are published as GeoTIFF
// tiles, which MapLibre cannot read. This transform decodes them and re-encodes
// terrarium PNGs once, then the cached tile is a normal elevation tile forever
// (also offline). `geotiff` is an optional dependency and is imported lazily, so
// projects that do not use GeoTIFF sources never load it.
import type { TileTransform } from "../types";
import {
  clampElevation,
  demSmoothingTransform,
  encodeTerrariumTile,
  smoothHeights,
} from "./terrarium";

/** Nearest-neighbour resize so any source tile size becomes `size` px. */
export function resizeNearest(
  source: Float32Array,
  srcW: number,
  srcH: number,
  size = 256,
): Float32Array {
  if (srcW === size && srcH === size) return source;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / size));
      out[y * size + x] = source[sy * srcW + sx];
    }
  }
  return out;
}

/** Decode a single band GeoTIFF (float or int) into a height grid. */
export async function decodeGeoTiffTile(
  bytes: ArrayBuffer,
): Promise<{ heights: Float32Array; size: number } | null> {
  try {
    const specifier = "geotiff";
    const geotiff = (await import(/* @vite-ignore */ specifier)) as any;
    const tiff = await geotiff.fromArrayBuffer(bytes);
    const image = await tiff.getImage();
    const width: number = image.getWidth();
    const height: number = image.getHeight();
    const rasters = await image.readRasters({ samples: [0] });
    const band = (Array.isArray(rasters) ? rasters[0] : rasters) as ArrayLike<number>;

    const heights = new Float32Array(width * height);
    for (let i = 0; i < heights.length; i++) heights[i] = clampElevation(band[i]);
    return { heights: resizeNearest(heights, width, height), size: 256 };
  } catch (error) {
    console.warn("[RadiumEngine] GeoTIFF tile could not be decoded", error);
    return null;
  }
}

/** GeoTIFF tile -> terrarium PNG (with the configured smoothing applied). */
export const geoTiffToTerrariumTransform: TileTransform = async (bytes, source) => {
  if (!source.geotiffTiles) return bytes;

  const decoded = await decodeGeoTiffTile(bytes);
  if (!decoded) return bytes;

  const passes = Math.max(0, Math.min(3, Math.round(source.smoothing ?? 0)));
  const heights = passes > 0 ? smoothHeights(decoded.heights, passes, decoded.size) : decoded.heights;
  return encodeTerrariumTile(heights, decoded.size);
};

/** The transform chain used by default: GeoTIFF decode, then DEM smoothing. */
export const defaultTileTransforms: TileTransform[] = [
  geoTiffToTerrariumTransform,
  demSmoothingTransform,
];
