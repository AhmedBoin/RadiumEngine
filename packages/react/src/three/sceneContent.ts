// src/three/sceneContent.ts — translate the shared scene into what the 3D layers
// need: fat lines, drop lines and DOM markers (plus polygon GeoJSON).
import { circle as circlePoints, type SceneStore } from "@radium-engine/core";
import type { DropLinesContent, LineContent } from "./linesLayer";
import type { LinePoint } from "./lineGeometry";

export type ContentOptions = {
  /** rendered ground (terrain-exaggeration aware) used as a floor for markers */
  groundAt: (lat: number, lon: number) => number;
  /** draw a red drop line from every object down to the ground */
  dropLines?: boolean;
};

/** Lines: polylines, circle outlines and recorded tracks. */
export function buildLines(store: SceneStore): LineContent[] {
  const lines: LineContent[] = [];

  for (const shape of store.snapshot().shapes) {
    if (shape.kind === "polyline") {
      lines.push({
        id: `polyline-${shape.id}`,
        points: shape.points as LinePoint[],
        color: shape.style?.color ?? "#eeff00",
        widthPx: shape.style?.widthPx ?? 3,
      });
    } else if (shape.kind === "circle") {
      lines.push({
        id: `circle-${shape.id}`,
        points: circlePoints(shape.center, shape.radiusM, 160).map((point) => ({
          lat: point.lat,
          lon: point.lon,
          alt: shape.style?.extrudeM ?? 0,
        })),
        color: shape.style?.color ?? "#22a34a",
        widthPx: shape.style?.widthPx ?? 2.5,
        /* circles stay perfectly round at any zoom */
        smooth: true,
      });
    } else if (shape.kind === "polygon" && shape.points.length >= 2) {
      const ring = [...shape.points, shape.points[0]];
      lines.push({
        id: `polygon-${shape.id}`,
        points: ring.map((point) => ({ lat: point.lat, lon: point.lon, alt: shape.style?.extrudeM ?? 0 })),
        color: shape.style?.color ?? "#22a34a",
        widthPx: shape.style?.widthPx ?? 3,
      });
    }
  }

  for (const track of store.tracksList()) {
    const points = track.getPoints();
    if (points.length < 2) continue;
    lines.push({
      id: `track-${track.id}`,
      points: points.map((point) => ({ lat: point.lat, lon: point.lon, alt: point.alt })),
      color: track.style?.color ?? "#6a0090",
      widthPx: track.style?.widthPx ?? 6,
      /* recorded tracks: filtered and splined so they stay smooth when zoomed */
      smooth: true,
      denoise: (track.style?.smoothing ?? 1) > 0,
    });
  }

  return lines;
}

/** Drop lines: from every object (and drop-line shape) down to the ground. */
export function buildDropLines(store: SceneStore, options: ContentOptions): DropLinesContent | null {
  if (options.dropLines === false) return null;
  const segments: [LinePoint, LinePoint][] = [];

  const add = (lat: number, lon: number, alt: number) => {
    const ground = options.groundAt(lat, lon);
    if (!Number.isFinite(alt) || alt - ground < 1) return;
    segments.push([
      { lat, lon, alt },
      { lat, lon, alt: ground },
    ]);
  };

  for (const spec of store.snapshot().objects) {
    if (spec.dropLine === false) continue;
    const pose = store.displayPose(spec.id) ?? spec.pose6;
    add(pose.lat, pose.lon, pose.alt);
  }
  for (const shape of store.snapshot().shapes) {
    if (shape.kind === "dropLine") add(shape.pose.lat, shape.pose.lon, shape.pose.alt);
  }

  if (segments.length === 0) return null;
  return { segments, color: "#ff2b2b", widthPx: 1.6 };
}
