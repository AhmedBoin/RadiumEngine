// src/MapView.tsx — one component, two engines, a flip of a coin.
import type { CSSProperties } from "react";
import { useMapEngine } from "./context";
import { LeafletEngine } from "./two/LeafletEngine";
import { MapLibreEngine } from "./three/MapLibreEngine";

export type MapViewProps = {
  className?: string;
  style?: CSSProperties;
};

/**
 * Renders the active engine. Both engines read the same scene store and the same
 * camera, so switching `mode` (via `useMapApi().setMode`) keeps everything in
 * place — 2D and 3D are the same map seen two ways.
 */
export function MapView({ className, style }: MapViewProps) {
  const { mode } = useMapEngine();
  return mode === "2d" ? (
    <LeafletEngine className={className} style={style} />
  ) : (
    <MapLibreEngine className={className} style={style} />
  );
}
