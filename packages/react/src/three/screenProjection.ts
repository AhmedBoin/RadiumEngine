// src/three/screenProjection.ts — "where is this 3D point on screen right now?"
//
// Picking needs the inverse of what the renderer does: the marker layer already positions
// every object with MapLibre is own projection matrix, altitude included, so the same matrix
// answers "which pixel is this position on?" EXACTLY — no metres-per-pixel guess, no
// ground-plane assumption (which would be wrong by `alt / mpp` pixels, ~490 px at zoom 18 for
// 100 m). The layer publishes the matrix it was given on each frame; this module remembers it.
import { MercatorCoordinate } from "maplibre-gl";

type Snapshot = { matrix: ArrayLike<number>; width: number; height: number };

let current: Snapshot | null = null;

/** Remember this frame is projection (called by the marker layer, which receives it). */
export function publishScreenProjection(
  matrix: ArrayLike<number> | null | undefined,
  cssWidth: number,
  cssHeight: number,
): void {
  if (!matrix || !(cssWidth > 0) || !(cssHeight > 0)) {
    current = null;
    return;
  }
  current = { matrix, width: cssWidth, height: cssHeight };
}

/** The map went away (or is being rebuilt): stop answering until the next frame. */
export function clearScreenProjection(): void {
  current = null;
}

export function hasScreenProjection(): boolean {
  return current !== null;
}

/**
 * The CSS-pixel position where the 3D layers draw this position, altitude included.
 * `null` when no frame has been published yet or the point is behind the camera — a caller
 * must treat that as "no hit", never as (0, 0).
 */
export function screenOf(lon: number, lat: number, altM = 0): { x: number; y: number } | null {
  if (!current) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const merc = MercatorCoordinate.fromLngLat([lon, lat], Number.isFinite(altM) ? altM : 0);
  const m = current.matrix;
  const { x, y, z } = merc;

  /* clip = matrix * (x, y, z, 1), column major — the same arithmetic the marker layer and the
     fat-line layer use, so a hit can never disagree with what is drawn */
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!Number.isFinite(cw) || cw <= 0) return null;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  return {
    x: ((cx / cw) * 0.5 + 0.5) * current.width,
    y: (1 - ((cy / cw) * 0.5 + 0.5)) * current.height,
  };
}