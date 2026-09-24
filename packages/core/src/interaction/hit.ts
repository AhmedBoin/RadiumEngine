// src/interaction/hit.ts — screen-space picking: one implementation, both engines.
//
// The rule that makes this work in 2D and 3D alike: everything is measured in CSS pixels,
// through the projector the engine supplies. A marker is a disc of `radiusPx`, a line is a
// capsule of `widthPx / 2`, a circle is a disc whose radius is the PIXEL distance between
// its centre and a point on its rim (so it is exact at any zoom, latitude or camera pitch —
// no metres-per-pixel assumption anywhere), and a polygon is inside-or-near-its-edge.
//
// Ties are broken by distance, then by what is drawn on top (a marker beats a line, a line
// beats a fill), then by `z`. Everything here is pure, so `npm run check:interaction`
// covers it with a fake projector.
import { distanceMeters, destinationPoint } from "../geo/sphere";
import type { HitCandidate, HitKind, MapHit, Projector, ScreenPoint } from "./types";

/** What is drawn on top, for tie-breaks (higher wins). */
const KIND_PRIORITY: Record<HitKind, number> = {
  object: 60,
  marker: 58,
  label: 56,
  circle: 24,
  track: 18,
  polyline: 16,
  polygon: 8,
};

/** Distance from a point to a segment, in pixels. */
export function distanceToSegmentPx(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Even-odd point-in-polygon on an already projected ring. */
export function pointInPolygonPx(point: ScreenPoint, ring: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type CandidateHit = {
  distancePx: number;
  lat: number;
  lon: number;
  altM?: number;
};

/**
 * How far the pointer is from ONE candidate (0 = inside it), plus the geographic position
 * of the closest point. `null` when the candidate is not on screen at all (behind the
 * camera, or off the canvas far enough that it cannot matter).
 */
export function hitCandidate(
  candidate: HitCandidate,
  point: ScreenPoint,
  project: Projector,
): CandidateHit | null {
  const projectAll = (points: { lat: number; lon: number; alt?: number }[]) => {
    const out: ScreenPoint[] = [];
    for (const p of points) {
      const screen = project(p.lat, p.lon, p.alt ?? 0);
      if (!screen) return null;
      out.push(screen);
    }
    return out;
  };

  /* a disc: markers, labels, objects, and circles (whose radius is metres) */
  if (candidate.center && candidate.points === undefined && candidate.polygon === undefined) {
    const anchors = [
      { lat: candidate.center.lat, lon: candidate.center.lon, alt: candidate.center.alt },
    ];
    if (candidate.radiusM != null) {
      const rim = destinationPoint({ lat: candidate.center.lat, lon: candidate.center.lon }, 90, candidate.radiusM);
      anchors.push({ lat: rim.lat, lon: rim.lon, alt: candidate.center.alt });
    }
    const screen = projectAll(anchors);
    if (!screen) return null;
    const centre = screen[0];
    const radiusPx =
      candidate.radiusM != null && screen.length > 1
        ? Math.hypot(screen[1].x - centre.x, screen[1].y - centre.y)
        : Math.max(0, candidate.radiusPx ?? 12);
    const distance = Math.hypot(point.x - centre.x, point.y - centre.y) - radiusPx;
    return {
      distancePx: Math.max(0, distance),
      lat: candidate.center.lat,
      lon: candidate.center.lon,
      altM: candidate.center.alt,
    };
  }

  /* a capsule: polylines and tracks */
  if (candidate.points && candidate.points.length >= 2) {
    const screen = projectAll(candidate.points);
    if (!screen) return null;
    const half = Math.max(0.5, (candidate.widthPx ?? 3) / 2);
    let best = Infinity;
    let bestAt = { lat: candidate.points[0].lat, lon: candidate.points[0].lon, altM: candidate.points[0].alt };
    for (let i = 0; i < screen.length - 1; i++) {
      const distance = distanceToSegmentPx(point, screen[i], screen[i + 1]) - half;
      if (distance >= best) continue;
      best = distance;
      /* where along the segment the pointer was: interpolate the geography there, so a
         status bar can show the position ON the line, not just its nearest vertex */
      const a = candidate.points[i];
      const b = candidate.points[i + 1];
      const dx = screen[i + 1].x - screen[i].x;
      const dy = screen[i + 1].y - screen[i].y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq < 1e-9
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point.x - screen[i].x) * dx + (point.y - screen[i].y) * dy) / lengthSq),
            );
      bestAt = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, altM: a.alt + (b.alt - a.alt) * t };
    }
    if (!Number.isFinite(best)) return null;
    return { distancePx: Math.max(0, best), lat: bestAt.lat, lon: bestAt.lon, altM: bestAt.altM };
  }

  /* a filled shape: inside is a hit, outside is the distance to its edge */
  if (candidate.polygon && candidate.polygon.length >= 3) {
    const ring = projectAll(candidate.polygon);
    if (!ring) return null;
    if (pointInPolygonPx(point, ring)) {
      return { distancePx: 0, lat: candidate.polygon[0].lat, lon: candidate.polygon[0].lon };
    }
    const half = Math.max(0.5, (candidate.widthPx ?? 2) / 2);
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      best = Math.min(best, distanceToSegmentPx(point, ring[i], ring[(i + 1) % ring.length]) - half);
    }
    return { distancePx: Math.max(0, best), lat: candidate.polygon[0].lat, lon: candidate.polygon[0].lon };
  }

  return null;
}

/**
 * The best hit at a screen position, or `null`. `tolerancePx` is the extra slack a caller
 * allows (a fingertip is not a mouse: touch UIs pass ~12).
 */
export function pickAtScreen(options: {
  point: ScreenPoint;
  candidates: HitCandidate[];
  project: Projector;
  tolerancePx?: number;
}): MapHit | null {
  return pickAllAtScreen(options)[0] ?? null;
}

/** Every candidate the pointer is on, best first (selection UIs use the tail). */
export function pickAllAtScreen(options: {
  point: ScreenPoint;
  candidates: HitCandidate[];
  project: Projector;
  tolerancePx?: number;
}): MapHit[] {
  const tolerance = Math.max(0, options.tolerancePx ?? 4);
  const hits: { hit: MapHit; priority: number; z: number }[] = [];

  for (const candidate of options.candidates) {
    const resolved = hitCandidate(candidate, options.point, options.project);
    if (!resolved || resolved.distancePx > tolerance) continue;
    hits.push({
      hit: {
        id: candidate.id,
        kind: candidate.kind,
        point: options.point,
        distancePx: resolved.distancePx,
        lat: resolved.lat,
        lon: resolved.lon,
        altM: resolved.altM,
      },
      priority: KIND_PRIORITY[candidate.kind] ?? 0,
      z: candidate.z ?? 0,
    });
  }

  hits.sort(
    (a, b) =>
      a.hit.distancePx - b.hit.distancePx || b.priority - a.priority || b.z - a.z || a.hit.id.localeCompare(b.hit.id),
  );
  return hits.map((entry) => entry.hit);
}

/** True when two hits are the same item (hover bookkeeping). */
export function sameHit(a: MapHit | null, b: MapHit | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.kind === b.kind;
}

/** Kept next to the maths it belongs to: how far two anchors are apart, in metres. */
export function anchorDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return distanceMeters(a, b);
}