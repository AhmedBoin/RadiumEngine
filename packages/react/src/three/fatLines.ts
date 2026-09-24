// src/three/fatLines.ts — thick, screen-space lines for the 3D engine.
//
// WebGL ignores LineBasicMaterial.linewidth (always 1 px) and a flat ribbon mesh
// changes thickness as the camera tilts, so lines use three.js's instanced fat
// lines: the width is applied in SCREEN space and stays constant at every camera
// orientation, in a single GPU draw call per line.
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { samplePositions, type LinePoint } from "./lineGeometry";
import { mercatorAt, type SceneOrigin } from "./sceneOrigin";

export type FatLineOptions = {
  color: string | number;
  widthPx: number;
  origin: SceneOrigin;
  /** resample with a Catmull-Rom spline (tracks, circles) */
  smooth?: boolean;
  /** filter GPS/altitude jitter (recorded tracks) */
  denoise?: boolean;
  unitsPerPixel?: number;
  maxChordPx?: number;
};

export type FatLine = { line: Line2; material: LineMaterial; widthPx: number };
export type SegmentLines = { line: LineSegments2; material: LineMaterial; widthPx: number };

function makeMaterial(options: FatLineOptions): LineMaterial {
  return new LineMaterial({
    color: options.color as any,
    linewidth: options.widthPx,
    worldUnits: false,
    transparent: false,
    /* overlays stay visible like the 2D ones, also over hills */
    depthTest: false,
    depthWrite: false,
  });
}

export function createFatLine(points: LinePoint[], options: FatLineOptions): FatLine | null {
  const flat = samplePositions(points, options.origin, options);
  if (!flat) return null;

  const geometry = new LineGeometry();
  geometry.setPositions(flat);
  const material = makeMaterial(options);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.frustumCulled = false;
  line.renderOrder = 10;
  return { line, material, widthPx: options.widthPx };
}

export function updateFatLine(target: FatLine, points: LinePoint[], options: FatLineOptions): boolean {
  const flat = samplePositions(points, options.origin, options);
  if (!flat) return false;

  const geometry = new LineGeometry();
  geometry.setPositions(flat);
  target.line.geometry.dispose();
  target.line.geometry = geometry;
  target.line.computeLineDistances();
  target.material.color.set(options.color as any);
  target.widthPx = options.widthPx;
  return true;
}

/** Independent straight segments (drop lines) in ONE draw call. */
export function createSegmentLines(
  segments: [LinePoint, LinePoint][],
  options: FatLineOptions,
): SegmentLines | null {
  const flat = segmentPositions(segments, options.origin);
  if (!flat.length) return null;

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(flat);
  const material = makeMaterial(options);
  const line = new LineSegments2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 9;
  return { line, material, widthPx: options.widthPx };
}

export function updateSegmentLines(
  target: SegmentLines,
  segments: [LinePoint, LinePoint][],
  origin: SceneOrigin,
): boolean {
  const flat = segmentPositions(segments, origin);
  if (!flat.length) return false;

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(flat);
  target.line.geometry.dispose();
  target.line.geometry = geometry;
  return true;
}

function segmentPositions(segments: [LinePoint, LinePoint][], origin: SceneOrigin): number[] {
  const flat: number[] = [];
  for (const [a, b] of segments) {
    const ma = mercatorAt(a.lat, a.lon, a.alt ?? 0);
    const mb = mercatorAt(b.lat, b.lon, b.alt ?? 0);
    flat.push(
      ma.x - origin.x,
      ma.y - origin.y,
      ma.z - origin.z,
      mb.x - origin.x,
      mb.y - origin.y,
      mb.z - origin.z,
    );
  }
  return flat;
}

/**
 * three's fat lines take the width in viewport (device) pixels, so the CSS width
 * is scaled by the device ratio and rounded to whole pixels (with a 2 CSS px
 * minimum) — that is what stops a thin line from shimmering while panning.
 */
export function applyLineWidth(
  target: { material: LineMaterial; widthPx: number },
  deviceRatio: number,
): void {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const width = Math.max(2, Math.round(Math.max(2, target.widthPx) * ratio));
  if (target.material.linewidth !== width) target.material.linewidth = width;
}

export function disposeFatLine(target: FatLine | SegmentLines): void {
  target.line.removeFromParent();
  target.line.geometry.dispose();
  target.material.dispose();
}
