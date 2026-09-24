// src/index.ts — the public surface of @radium-engine/react.
export { MapProvider } from "./MapProvider";
export { MapView } from "./MapView";
export type { MapViewProps } from "./MapView";

export {
  useMapApi,
  useMapEngine,
  useMapMode,
  useScene,
  useSceneStore,
  useElevationService,
} from "./context";
export type {
  CameraOptions,
  EngineHandlers,
  FlyTarget,
  MapApi,
  MapEngineContextValue,
  MapEngineOptions,
} from "./context";

export {
  Circle,
  DropLine,
  Label,
  MapObject,
  Marker,
  Polygon,
  Polyline,
  Track,
} from "./items";
export type {
  CircleProps,
  DropLineProps,
  LabelProps,
  MapObjectProps,
  MarkerProps,
  PolygonProps,
  PolylineProps,
  TrackProps,
} from "./items";

/* advanced: the pieces the engines are built from */
export { buildRadiumStyle } from "./three/style";
export { registerRadiumProtocol, radiumTileUrl } from "./three/protocol";
export { createLinesLayer } from "./three/linesLayer";
export { createMarkersLayer } from "./three/markersLayer";
export { createCachedTileLayer } from "./two/tileLayer";

/* demo/dev helper: real moving pose6 values without a live feed */
export { useSimulatedTraffic } from "./useSimulatedTraffic";
export type { UseSimulatedTrafficOptions } from "./useSimulatedTraffic";

export * from "@radium-engine/core";
