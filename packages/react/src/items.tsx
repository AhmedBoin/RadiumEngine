// src/items.tsx — the declarative API: the same components in 2D and in 3D.
//
// Every component writes into the shared SceneStore and renders `null`; the
// engines read that store imperatively (every frame when something moves), so a
// 60 Hz telemetry feed never re-renders the React tree.
import type {
  FillStyle,
  LatLng,
  LatLngAlt,
  ModelSpec,
  MotionOptions,
  Pose6,
  StrokeStyle,
  TrackStyle,
} from "@radium-engine/core";
import { useEffect, useMemo } from "react";
import { useMapEngine } from "./context";

/* ── <MapObject> ─────────────────────────────────────────────────────── */

export type MapObjectProps = {
  id: string;
  pose6: Pose6;
  model?: ModelSpec;
  /** flat icon size in CSS px (identical in 2D and 3D) */
  pixels?: number;
  motion?: MotionOptions;
  /** red line from the object down to the ground in 3D */
  dropLine?: boolean | StrokeStyle;
  /** record a track while the object moves */
  track?: { maxSeconds?: number; maxMetres?: number; maxPoints?: number; simplifyM?: number; style?: TrackStyle };
  visible?: boolean;
  /** icon tint for the default pin */
  color?: string;
  zIndex?: number;
  data?: unknown;
};

export function MapObject({ id, pose6, model, pixels, motion, dropLine, track, visible, color, zIndex, data }: MapObjectProps) {
  const { store, bump } = useMapEngine();

  /* the hot path: a new pose simply replaces the last one */
  useEffect(() => {
    store.setPose(id, pose6, motion);
    if (track) store.ensureTrack(id, track);
  }, [store, id, pose6.lat, pose6.lon, pose6.alt, pose6.yaw, pose6.roll, pose6.pitch, motion?.mode, motion?.lagMs, track?.maxSeconds, track?.maxMetres, track?.maxPoints, track?.simplifyM]);

  /* the cold path: anything that changes what the object looks like */
  const descriptor = useMemo(
    () => JSON.stringify({ model, pixels, dropLine, visible, color, zIndex }),
    [model, pixels, dropLine, visible, color, zIndex],
  );
  useEffect(() => {
    store.upsert({ id, pose6, model, pixels, motion, dropLine, visible, color, zIndex, data } as any);
    bump();
    return () => {
      store.remove(id);
      bump();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id, descriptor]);

  return null;
}

/* ── <Track> ─────────────────────────────────────────────────────────── */

export type TrackProps = {
  id: string;
  maxSeconds?: number;
  maxMetres?: number;
  maxPoints?: number;
  simplifyM?: number;
  style?: TrackStyle;
};

/** Configures the track of an object id (the recorder lives in the store). */
export function Track({ id, maxSeconds, maxMetres, maxPoints, simplifyM, style }: TrackProps) {
  const { store, bump } = useMapEngine();
  useEffect(() => {
    store.ensureTrack(id, { maxSeconds, maxMetres, maxPoints, simplifyM, style });
    bump();
    return () => {
      /* tracks outlive their component: the history is data, not UI */
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id, maxSeconds, maxMetres, maxPoints, simplifyM, JSON.stringify(style)]);
  return null;
}

/* ── drawing primitives ──────────────────────────────────────────────── */

function useShape(shape: any, signature: string) {
  const { store, bump } = useMapEngine();
  useEffect(() => {
    store.setShape(shape);
    bump();
    return () => {
      store.removeShape(shape.id);
      bump();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, shape.id, signature]);
}

export type PolylineProps = { id: string; points: LatLngAlt[]; style?: StrokeStyle };
export function Polyline({ id, points, style }: PolylineProps) {
  useShape({ kind: "polyline", id, points, style }, useMemo(() => JSON.stringify({ points, style }), [points, style]));
  return null;
}

export type PolygonProps = { id: string; points: LatLng[]; style?: StrokeStyle & FillStyle };
export function Polygon({ id, points, style }: PolygonProps) {
  useShape({ kind: "polygon", id, points, style }, useMemo(() => JSON.stringify({ points, style }), [points, style]));
  return null;
}

export type CircleProps = { id: string; center: LatLng; radiusM: number; style?: StrokeStyle & FillStyle };
export function Circle({ id, center, radiusM, style }: CircleProps) {
  useShape({ kind: "circle", id, center, radiusM, style }, useMemo(() => JSON.stringify({ center, radiusM, style }), [center, radiusM, style]));
  return null;
}

export type DropLineProps = { id: string; pose: Pose6; style?: StrokeStyle };
export function DropLine({ id, pose, style }: DropLineProps) {
  useShape({ kind: "dropLine", id, pose, style }, useMemo(() => JSON.stringify({ pose, style }), [pose, style]));
  return null;
}

export type LabelProps = {
  id: string;
  pose: LatLngAlt;
  text: string;
  style?: { color?: string; fontSizePx?: number; background?: string };
};
export function Label({ id, pose, text, style }: LabelProps) {
  useShape({ kind: "label", id, pose, text, style }, useMemo(() => JSON.stringify({ pose, text, style }), [pose, text, style]));
  return null;
}

export type MarkerProps = {
  id: string;
  pose: LatLngAlt;
  model: ModelSpec;
  rotationDeg?: number;
  style?: { zIndex?: number; interactive?: boolean };
};
export function Marker({ id, pose, model, rotationDeg, style }: MarkerProps) {
  useShape(
    { kind: "marker", id, pose, model, rotationDeg, style },
    useMemo(() => JSON.stringify({ pose, model, rotationDeg, style }), [pose, model, rotationDeg, style]),
  );
  return null;
}
