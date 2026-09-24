// src/items.tsx — the declarative API: the same components in 2D and in 3D.
//
// Every component writes into the shared SceneStore and renders `null`; the engines read that
// store imperatively (every frame when something moves), so a 60 Hz feed never re-renders the
// React tree.
//
// Interaction is declarative too: giving an item `onClick` (or `onHover`, `onContextMenu`, …)
// registers it as pickable, and the handler receives a unified payload — the same in 2D and in
// 3D, with the geographic position of the hit, not just the item:
//
//   <MapObject id="uav-1" pose6={pose} onClick={({ hit, pointer }) => select(hit.id)} />
import type {
  FillStyle,
  LatLng,
  LatLngAlt,
  ModelSpec,
  MotionOptions,
  PointerEventPayload,
  Pose6,
  StrokeStyle,
  TrackStyle,
} from "@radium-engine/core";
import { useEffect, useMemo } from "react";
import { useMapEngine } from "./context";
import { useItemInteraction } from "./interaction";

/**
 * What every item can react to. Providing any handler makes the item pickable; `interactive`
 * opts in without a handler (for a click handler that lives higher up the tree).
 */
export type ItemInteractionProps = {
  onClick?: (event: PointerEventPayload) => void;
  onDoubleClick?: (event: PointerEventPayload) => void;
  onContextMenu?: (event: PointerEventPayload) => void;
  onHover?: (event: PointerEventPayload) => void;
  onHoverEnd?: (event: PointerEventPayload) => void;
  /** pickable even without handlers (default: true when a handler is given) */
  interactive?: boolean;
};

/**
 * Registers an item with the interaction layer. `DropLine` has no interaction on purpose:
 * a vertical decoration that follows an object is not something a user aims at.
 */
function useInteractions(id: string, kind: Parameters<typeof useItemInteraction>[1], props: ItemInteractionProps) {
  useItemInteraction(
    id,
    kind,
    {
      onClick: props.onClick,
      onDoubleClick: props.onDoubleClick,
      onContextMenu: props.onContextMenu,
      onHover: props.onHover,
      onHoverEnd: props.onHoverEnd,
    },
    { interactive: props.interactive },
  );
}
/* ── <MapObject> ─────────────────────────────────────────────────────── */

export type MapObjectProps = ItemInteractionProps & {
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

export function MapObject({
  id,
  pose6,
  model,
  pixels,
  motion,
  dropLine,
  track,
  visible,
  color,
  zIndex,
  data,
  ...interaction
}: MapObjectProps) {
  const { store, bump } = useMapEngine();
  useInteractions(id, "object", interaction);

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

export type TrackProps = ItemInteractionProps & {
  id: string;
  maxSeconds?: number;
  maxMetres?: number;
  maxPoints?: number;
  simplifyM?: number;
  style?: TrackStyle;
};

/** Configures the track of an object id (the recorder lives in the store). */
export function Track({
  id,
  maxSeconds,
  maxMetres,
  maxPoints,
  simplifyM,
  style,
  ...interaction
}: TrackProps) {
  const { store, bump } = useMapEngine();
  useInteractions(id, "track", interaction);
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

export type PolylineProps = ItemInteractionProps & { id: string; points: LatLngAlt[]; style?: StrokeStyle };
export function Polyline({ id, points, style, ...interaction }: PolylineProps) {
  useInteractions(id, "polyline", interaction);
  useShape(
    { kind: "polyline", id, points, style },
    useMemo(() => JSON.stringify({ points, style }), [points, style]),
  );
  return null;
}

export type PolygonProps = ItemInteractionProps & { id: string; points: LatLng[]; style?: StrokeStyle & FillStyle };
export function Polygon({ id, points, style, ...interaction }: PolygonProps) {
  useInteractions(id, "polygon", interaction);
  useShape(
    { kind: "polygon", id, points, style },
    useMemo(() => JSON.stringify({ points, style }), [points, style]),
  );
  return null;
}

export type CircleProps = ItemInteractionProps & {
  id: string;
  center: LatLng;
  radiusM: number;
  style?: StrokeStyle & FillStyle;
};
export function Circle({ id, center, radiusM, style, ...interaction }: CircleProps) {
  useInteractions(id, "circle", interaction);
  useShape(
    { kind: "circle", id, center, radiusM, style },
    useMemo(() => JSON.stringify({ center, radiusM, style }), [center, radiusM, style]),
  );
  return null;
}

export type DropLineProps = { id: string; pose: Pose6; style?: StrokeStyle };
/** A vertical decoration: never pickable (it follows an object nobody aims at). */
export function DropLine({ id, pose, style }: DropLineProps) {
  useShape(
    { kind: "dropLine", id, pose, style },
    useMemo(() => JSON.stringify({ pose, style }), [pose, style]),
  );
  return null;
}

export type LabelProps = ItemInteractionProps & {
  id: string;
  pose: LatLngAlt;
  text: string;
  style?: { color?: string; fontSizePx?: number; background?: string };
};
export function Label({ id, pose, text, style, ...interaction }: LabelProps) {
  useInteractions(id, "label", interaction);
  useShape(
    { kind: "label", id, pose, text, style },
    useMemo(() => JSON.stringify({ pose, text, style }), [pose, text, style]),
  );
  return null;
}

export type MarkerProps = ItemInteractionProps & {
  id: string;
  pose: LatLngAlt;
  model: ModelSpec;
  rotationDeg?: number;
  style?: { zIndex?: number; interactive?: boolean };
};
export function Marker({ id, pose, model, rotationDeg, style, ...interaction }: MarkerProps) {
  useInteractions(id, "marker", interaction);
  useShape(
    { kind: "marker", id, pose, model, rotationDeg, style },
    useMemo(() => JSON.stringify({ pose, model, rotationDeg, style }), [pose, model, rotationDeg, style]),
  );
  return null;
}
