// src/types.ts — the vocabulary of RadiumEngine.
//
// Everything the engines (Leaflet 2D, MapLibre + three.js 3D) render is
// described by these types only, so the same declarative tree works in both.

/** Degrees. */
export type LatLng = { lat: number; lon: number };
/** Degrees + meters above mean sea level. */
export type LatLngAlt = { lat: number; lon: number; alt: number };

/**
 * Position + attitude of any object, exactly the six numbers a flight control
 * or a game entity provides:
 *   lat / lon  degrees (WGS84)
 *   alt        meters above mean sea level
 *   roll       degrees, positive = right wing down
 *   pitch      degrees, positive = nose up
 *   yaw        degrees, 0 = north, clockwise (compass heading)
 */
export type Pose6 = {
  lat: number;
  lon: number;
  alt: number;
  roll: number;
  pitch: number;
  yaw: number;
};

export type MapMode = "2d" | "3d";

/** How an object travels between two received poses. */
export type MotionMode =
  /** draw exactly what was received (may look steppy at low rates) */
  | "jump"
  /** interpolate between poses with an interpolation buffer (smooth) */
  | "smooth";

export type MotionOptions = {
  mode?: MotionMode;
  /** how far behind the newest pose the scene is rendered, ms (default 280) */
  lagMs?: number;
  /** how long the last velocity keeps the object moving, ms (default 2000) */
  maxExtrapolationMs?: number;
};

/** An RGBA/hex colour accepted by every style. */
export type Color = string | number;

export type StrokeStyle = {
  color: Color;
  /** on screen width in CSS pixels (identical in 2D and 3D) */
  widthPx?: number;
  opacity?: number;
  dashed?: boolean;
  dashPx?: number;
  gapPx?: number;
};

export type FillStyle = {
  color: Color;
  opacity?: number;
  /** extruded height in meters when drawn in 3D (fences, volumes) */
  extrudeM?: number;
  /** skirt/base height for the extrusion */
  baseM?: number;
};

/** Per-engine overrides: one declarative item, two renderers. */
export type StyleOverride<S> = { style2D?: Partial<S>; style3D?: Partial<S> };

export type TrackStyle = StrokeStyle & {
  /** smooth the recorded track (removes GPS jitter); 0 = raw */
  smoothing?: number;
  /** resample spacing in meters before smoothing (default 2.5 m) */
  resampleM?: number;
};

export type TrackOptions = {
  id: string;
  /** keep at most this many seconds of history */
  maxSeconds?: number;
  /** keep at most this many meters of history */
  maxMetres?: number;
  /** hard cap on stored points */
  maxPoints?: number;
  /** Douglas-Peucker tolerance in meters (0 = keep every point) */
  simplifyM?: number;
  style?: TrackStyle;
};

/** What an object's body is. */
export type ModelSpec =
  /** 2D icon (html/svg/url) both engines draw; 3D extrudes it automatically */
  | { kind: "icon"; html?: string; src?: string; widthPx?: number; heightPx?: number; anchorPx?: [number, number] }
  /** an icon converted to the same 3D shape as the flat 2D icon */
  | { kind: "icon3d"; icon?: string; html?: string; pixels?: number }
  /** a glTF/GLB model, normalised to the configured pixel size */
  | { kind: "glb"; src: string; pixels?: number; yawOffsetDeg?: number };

export type MapObjectSpec = {
  id: string;
  pose6: Pose6;
  model?: ModelSpec;
  /** flat icon size in CSS px when `model` is an icon (default 64) */
  pixels?: number;
  motion?: MotionOptions;
  /** draw a vertical line from the object down to the ground in 3D */
  dropLine?: boolean | StrokeStyle;
  /** record a track with these options */
  track?: Omit<TrackOptions, "id">;
  visible?: boolean;
  /** free form data for the application (never rendered) */
  data?: unknown;
};

export type MapItemEvent = {
  id: string;
  type: "added" | "updated" | "removed";
  item?: MapObjectSpec;
};
