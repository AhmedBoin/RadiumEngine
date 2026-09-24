// src/three/applyCamera.ts — push a `CameraFrame` into a MapLibre map.
//
// The eye modes (`chase`, `fpv`) go through MapLibre's OWN inverse — the same maths
// the map uses — because a hand-rolled `elevation = alt − D·cos pitch` disagrees with
// it exactly in the near-horizontal views: the transform clamps the centre elevation
// and then DERIVES the zoom from the geometry, so a "fixed eye" would drift as the
// pitch, roll or zoom changed. The closed-form placement from core stays as the
// fallback (and as the model the check script verifies).
import { eyePlacement, type CameraFrame } from "@radium-engine/core";
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The slice of MapLibre this module needs, structurally typed so the module keeps
 * working with a stubbed map (node tests) and with newer/older versions.
 */
export type CameraSolverMap = {
  calculateCameraOptionsFromCameraLngLatAltRotation?: (
    lngLat: [number, number],
    altitude: number,
    bearing: number,
    pitch: number,
    roll?: number,
  ) =>
    | {
        center: { lng: number; lat: number };
        elevation?: number;
        zoom: number;
        bearing: number;
        pitch: number;
        roll?: number;
      }
    | undefined;
};

export type ApplyCameraOptions = {
  /** canvas height in CSS pixels (the fallback placement needs it) */
  heightPx?: number;
  /** UI padding to keep clear of the framed object */
  paddingPx?: { top: number; right: number; bottom: number; left: number };
};

/** The map's height in CSS pixels (falls back to the device pixel height). */
export function canvasHeightPx(map: MapLibreMap): number {
  const canvas = map.getCanvas?.();
  return canvas?.clientHeight || canvas?.height || 800;
}

/**
 * Apply a frame. `kind: "centre"` frames jump straight to the centre (what `follow`
 * needs: it is a `panTo` with the parallax offset already in the position);
 * `kind: "eye"` solves for the camera whose eye is at `frame.eye`.
 */
export function applyCameraFrame(
  map: MapLibreMap,
  frame: CameraFrame,
  options: ApplyCameraOptions = {},
): void {
  const heightPx = options.heightPx ?? canvasHeightPx(map);
  const padding = options.paddingPx;

  if (frame.kind === "centre" || !frame.eye) {
    map.jumpTo({
      center: [frame.center.lon, frame.center.lat],
      zoom: frame.zoom,
      bearing: frame.bearing,
      pitch: frame.pitch,
      ...(padding ? { padding } : {}),
    } as any);
    return;
  }

  const solver = (map as unknown as CameraSolverMap)
    .calculateCameraOptionsFromCameraLngLatAltRotation;
  if (typeof solver === "function") {
    try {
      const solved = solver.call(
        map,
        [frame.eye.lon, frame.eye.lat],
        frame.eye.altMsl,
        frame.bearing,
        frame.pitch,
        frame.roll,
      );
      if (
        solved &&
        Number.isFinite(solved.zoom) &&
        Number.isFinite(solved.center?.lat) &&
        Number.isFinite(solved.center?.lng) &&
        Number.isFinite(solved.elevation as number)
      ) {
        map.jumpTo({
          center: [solved.center.lng, solved.center.lat],
          zoom: solved.zoom,
          bearing: solved.bearing,
          pitch: solved.pitch,
          roll: Number.isFinite(solved.roll as number) ? solved.roll : frame.roll,
          elevation: solved.elevation,
          ...(padding ? { padding } : {}),
        } as any);
        return;
      }
    } catch {
      /* fall through to the closed form */
    }
  }

  const placement = eyePlacement({
    eyeLat: frame.eye.lat,
    eyeLng: frame.eye.lon,
    eyeAltMsl: frame.eye.altMsl,
    bearingDeg: frame.bearing,
    pitchDeg: frame.pitch,
    zoom: frame.zoom,
    heightPx,
  });
  map.jumpTo({
    center: [placement.center.lon, placement.center.lat],
    zoom: frame.zoom,
    bearing: frame.bearing,
    pitch: frame.pitch,
    elevation: placement.elevation,
    ...(padding ? { padding } : {}),
  } as any);
}

/**
 * Tell the map how big its lens is — the free-look "digital zoom" (the camera does
 * not move, the field of view narrows, exactly like a video link's zoom).
 */
export function setMapFov(map: MapLibreMap, fovDeg: number): void {
  const transform = (map as unknown as { transform?: { setFov?: (fov: number) => void } }).transform;
  if (transform?.setFov) {
    try {
      transform.setFov(fovDeg);
    } catch {
      /* the transform may not be ready yet */
    }
  }
}

/** The field of view a digital zoom factor implies, for a base FOV. */
export function fovForDigitalZoom(zoomFactor: number, baseFovDeg = 36.87): number {
  const factor = Number.isFinite(zoomFactor) ? Math.max(1, zoomFactor) : 1;
  return Math.max(8, Math.min(120, baseFovDeg / factor));
}
