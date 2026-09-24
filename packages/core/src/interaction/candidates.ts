// src/interaction/candidates.ts — the scene store, described in a way a hit test can use.
//
// One function for both engines: it reads the SAME store the 2D and 3D renderers draw, so
// what you can click always matches what you can see, and an item added while a mode flip is
// in flight is pickable on both sides.
import type { SceneSnapshot } from "../scene/store";
import type { TrackRecorder } from "../tracks/recorder";
import type { HitCandidate, HitKind } from "./types";

/** What is drawn on top, by default (a caller can override `z` per item). */
const DEFAULT_Z: Record<HitKind, number> = {
  object: 100,
  marker: 90,
  label: 80,
  circle: 30,
  track: 25,
  polyline: 20,
  polygon: 10,
};

/**
 * A recorded track is named `track:<object>`, and it has to be: a track normally belongs to
 * an object and SHARES its id, and two candidates with one id make a selection ambiguous
 * (which one did the user mean, and what does `selected.has(id)` refer to?). `trackId()`
 * namespaces it; `trackObjectId()` maps it back.
 */
export function trackId(id: string): string {
  return id.startsWith("track:") ? id : "track:" + id;
}

/** The object a track candidate belongs to. */
export function trackObjectId(id: string): string {
  return id.startsWith("track:") ? id.slice(6) : id;
}

/** The screen hit radius of an object/marker icon (its drawn size, half of it). */
function iconRadiusPx(pixels: number | undefined): number {
  return Math.max(10, (pixels ?? 48) / 2);
}

/**
 * Everything pickable in a snapshot, plus the recorded tracks.
 *
 * `include` filters by kind, which is how a caller says "only aircraft are clickable"
 * without touching the scene: hover highlighting a 10 000 point track would be wasted work.
 */
export function hitCandidates(
  snapshot: SceneSnapshot,
  tracks: TrackRecorder[] = [],
  options: { include?: HitKind[]; widths?: { track?: number; polyline?: number; polygon?: number } } = {},
): HitCandidate[] {
  const include = options.include ? new Set(options.include) : null;
  const wants = (kind: HitKind) => !include || include.has(kind);
  const out: HitCandidate[] = [];

  if (wants("object")) {
    for (const object of snapshot.objects) {
      if (object.visible === false) continue;
      const pixels =
        object.pixels ??
        (object.model?.kind === "icon" ? object.model.widthPx ?? object.model.heightPx : undefined) ??
        (object.model?.kind === "icon3d" ? object.model.pixels : undefined);
      out.push({
        id: object.id,
        kind: "object",
        center: { lat: object.pose6.lat, lon: object.pose6.lon, alt: object.pose6.alt },
        radiusPx: iconRadiusPx(pixels),
        z: (object as { zIndex?: number }).zIndex ?? DEFAULT_Z.object,
      });
    }
  }

  for (const shape of snapshot.shapes) {
    switch (shape.kind) {
      case "polyline":
        if (!wants("polyline") || shape.points.length < 2) break;
        out.push({
          id: shape.id,
          kind: "polyline",
          points: shape.points,
          widthPx: options.widths?.polyline ?? shape.style?.widthPx ?? 3,
          z: DEFAULT_Z.polyline,
        });
        break;
      case "polygon":
        if (!wants("polygon") || shape.points.length < 3) break;
        out.push({
          id: shape.id,
          kind: "polygon",
          polygon: shape.points,
          widthPx: options.widths?.polygon ?? shape.style?.widthPx ?? 2,
          z: DEFAULT_Z.polygon,
        });
        break;
      case "circle":
        if (!wants("circle")) break;
        out.push({
          id: shape.id,
          kind: "circle",
          center: { lat: shape.center.lat, lon: shape.center.lon, alt: 0 },
          radiusM: shape.radiusM,
          z: DEFAULT_Z.circle,
        });
        break;
      case "marker":
        if (!wants("marker")) break;
        out.push({
          id: shape.id,
          kind: "marker",
          center: { lat: shape.pose.lat, lon: shape.pose.lon, alt: shape.pose.alt },
          radiusPx: 16,
          z: DEFAULT_Z.marker,
        });
        break;
      case "label":
        if (!wants("label")) break;
        out.push({
          id: shape.id,
          kind: "label",
          center: { lat: shape.pose.lat, lon: shape.pose.lon, alt: shape.pose.alt },
          radiusPx: 14,
          z: DEFAULT_Z.label,
        });
        break;
    }
  }

  if (wants("track")) {
    for (const track of tracks) {
      const points = track.getPoints();
      if (points.length < 2) continue;
      out.push({
        id: trackId(track.id),
        kind: "track",
        points: points.map((point) => ({ lat: point.lat, lon: point.lon, alt: point.alt })),
        widthPx: options.widths?.track ?? track.style?.widthPx ?? 4,
        z: DEFAULT_Z.track,
      });
    }
  }

  return out;
}