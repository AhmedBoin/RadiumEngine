// src/interaction/types.ts — what a click, a hover and a selection are.
//
// Picking is done in SCREEN SPACE, deliberately: the 3D lines are fat lines whose width is
// constant in pixels and markers are DOM elements with a pixel size, so a user who clicks a
// 6 px line expects a ~6 px hit area at every zoom and pitch. It is also the only test that
// is identical in both engines — a Leaflet map and a MapLibre map can both project a
// position to a pixel — so one implementation serves 2D and 3D.
import type { LatLng, LatLngAlt } from "../types";

export type ScreenPoint = { x: number; y: number };

/** What was hit. `kind` is the drawing primitive, so a caller can filter. */
export type HitKind = "object" | "marker" | "label" | "circle" | "polyline" | "polygon" | "track";

/**
 * Anything that can be picked. Ids are unique per kind, so an object and a track may share
 * one without confusing a caller that looks at `kind` too.
 */
export type HitCandidate = {
  id: string;
  kind: HitKind;
  /** higher wins when two candidates are equally close (drawing order) */
  z?: number;
  /** markers, labels, circles: the anchor */
  center?: LatLngAlt;
  /** circles: radius in metres (converted to pixels through the projector) */
  radiusM?: number;
  /** markers/labels: the hit radius in CSS px (defaults to half the drawn size) */
  radiusPx?: number;
  /** polylines and tracks: the drawn line */
  points?: LatLngAlt[];
  /** the drawn width in CSS px (a wider line is easier to hit) */
  widthPx?: number;
  /** polygons: the filled area, in order */
  polygon?: LatLng[];
};

/** A resolved hit: what, where on screen, and how far away it was. */
export type MapHit = {
  id: string;
  kind: HitKind;
  /** the pointer position in CSS px relative to the map container */
  point: ScreenPoint;
  /** how far the pointer was from the item, in CSS px (0 = inside it) */
  distancePx: number;
  /** the geographic position of the hit (the item anchor for objects/markers) */
  lat: number;
  lon: number;
  /** the item altitude when it has one (markers float above the ground) */
  altM?: number;
};

/** Where the cursor is, in both coordinate systems. */
export type PointerInfo = {
  /** CSS px inside the map container */
  screen: ScreenPoint;
  lat: number;
  lon: number;
  /** true while the pointer is inside the map */
  inside: boolean;
};

/** The engine supplies this: a geographic position -> CSS px inside the map container. */
export type Projector = (lat: number, lon: number, alt?: number) => ScreenPoint | null;

export type PointerEventPayload = {
  hit: MapHit | null;
  pointer: PointerInfo;
  /** the raw browser event (or a synthetic one, in tests) */
  original: unknown;
};

export type InteractionHandlers = {
  onClick?: (event: PointerEventPayload) => void;
  onDoubleClick?: (event: PointerEventPayload) => void;
  onContextMenu?: (event: PointerEventPayload) => void;
  onHover?: (event: PointerEventPayload) => void;
  /** called when a hover of this item ends (the pointer left it) */
  onHoverEnd?: (event: PointerEventPayload) => void;
};