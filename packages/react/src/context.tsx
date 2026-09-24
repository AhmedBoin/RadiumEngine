// src/context.tsx — types, context and hooks shared by both engines.
//
// The provider (MapProvider.tsx) owns the cache, tile pipeline, elevation service
// and the scene store; both engines (Leaflet 2D, MapLibre + three.js 3D) render
// exactly that state, which is why the same tree works in both modes.
import type {
  CacheConfig,
  MapHit,
  DemSource,
  ImageryProvider,
  MapMode,
  SceneStore,
  TerrainOptions,
  TilePipeline,
  ElevationService,
} from "@radium-engine/core";
import { createContext, useContext } from "react";

export type CameraOptions = {
  lat: number;
  lon: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
};

export type MapEngineOptions = {
  mode?: MapMode;
  /** Imagery provider id, or a custom `{ url, subdomains?, attribution? }`. */
  imagery?: string | ({ url: string } & Partial<ImageryProvider>);
  /** Terrain configuration; `false` disables elevation (flat 3D map). */
  terrain?: TerrainOptions | false;
  /** Vertical exaggeration of the rendered terrain (default 1). */
  exaggeration?: number;
  /** Where tiles are cached and how much memory to keep. */
  cache?: CacheConfig & { enabled?: boolean };
  camera?: CameraOptions;
  /** Camera pitch used when switching to 3D (default 60). */
  defaultPitch?: number;
  /** Keep the camera when flipping 2D <-> 3D (default true). */
  shareCamera?: boolean;
  /** Show the attribution control (default true). */
  attribution?: boolean;
  /** Log tile traffic (development aid). */
  debug?: boolean;
};

export type FlyTarget = Partial<CameraOptions> & { lat: number; lon: number };

export type MapApi = {
  mode: MapMode;
  /** Flip 2D <-> 3D keeping the camera (the "flip of a coin"). */
  setMode: (mode: MapMode) => void;
  getMode: () => MapMode;
  flyTo: (target: FlyTarget, options?: { durationMs?: number }) => void;
  fitBounds: (
    bounds: { west: number; south: number; east: number; north: number },
    options?: { paddingPx?: number; durationMs?: number },
  ) => void;
  getCamera: () => CameraOptions;
  /**
   * What is under a point of the map container, in CSS px — resolved the same way a click is
   * (screen-space hit test, see `interaction.tsx`). `null` when the point hits nothing
   * pickable, or when no engine is mounted.
   */
  pick: (x: number, y: number) => MapHit | null;
  /** The raw engine map (Leaflet map / MapLibre map) for advanced use. */
  getEngineMap: () => unknown;
  /** @internal the engines register their implementations here */
  bind: (handlers: Partial<EngineHandlers>) => void;
};

export type EngineHandlers = {
  flyTo: MapApi["flyTo"];
  fitBounds: MapApi["fitBounds"];
  getCamera: () => CameraOptions;
  getEngineMap: () => unknown;
  /** installed by the interaction layer when an engine is mounted */
  pick?: (x: number, y: number) => MapHit | null;
};

export type MapEngineContextValue = {
  options: MapEngineOptions &
    Required<Pick<MapEngineOptions, "mode" | "exaggeration" | "defaultPitch" | "shareCamera" | "attribution">>;
  store: SceneStore;
  pipeline: TilePipeline | null;
  elevation: ElevationService | null;
  imagery: ImageryProvider;
  terrain: DemSource | null;
  /** The camera both engines agree on. */
  camera: CameraOptions;
  setCamera: (camera: Partial<CameraOptions>) => void;
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  api: MapApi;
  ready: boolean;
  setReady: (ready: boolean) => void;
  /** Cache statistics for status strips and settings screens. */
  status: () => Promise<{ adapter: string; entries: number; bytes: number }>;
  /** Bumped whenever something outside React needs a re-render. */
  version: number;
  bump: () => void;
};

export const EngineContext = createContext<MapEngineContextValue | null>(null);

export function useMapEngine(): MapEngineContextValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error("RadiumEngine: <MapProvider> is missing above this component");
  return value;
}

/** Imperative escape hatch: camera, cache, store, everything. */
export function useMapApi(): MapApi {
  return useMapEngine().api;
}

export function useMapMode(): [MapMode, (mode: MapMode) => void] {
  const { mode, setMode } = useMapEngine();
  return [mode, setMode];
}

export function useSceneStore(): SceneStore {
  return useMapEngine().store;
}

export function useElevationService(): ElevationService | null {
  return useMapEngine().elevation;
}

/** Re-renders whenever the scene changes (objects, tracks, shapes). */
export function useScene() {
  const { store, version } = useMapEngine();
  const snapshot = store.snapshot();
  return { ...snapshot, store, version };
}
