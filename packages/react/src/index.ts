export { MapProvider } from "./MapProvider";
export { MapView } from "./MapView";
export type { MapViewProps } from "./MapView";

/* interaction: clicks, hovers and selection, in 2D and 3D alike */
export {
  InteractionProvider,
  MapInteractionLayer,
  useHovered,
  useInteractionState,
  useItemInteraction,
  useMapInteraction,
  usePick,
  usePointer,
  useSelection,
} from "./interaction";
export type {
  InteractionProviderProps,
  InteractionSnapshot,
  MapInteractionApi,
  MapInteractionLayerProps,
  RegisteredItem,
  UseSelectionResult,
} from "./interaction";
/* camera: a follow mode is one component */
export { FollowCamera, toFollowTarget } from "./FollowCamera";
export type { FollowCameraProps } from "./FollowCamera";

/* persisted options, with the load-before-write rule built in */
export {
  resolveAdapter,
  useSettings,
  useSettingsStatus,
  useSettingsStore,
  useSettingsStoreFactory,
} from "./useEngineSettings";
export type { SettingsStoreHookOptions, UseSettingsResult } from "./useEngineSettings";

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
  ItemInteractionProps,
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

/* camera internals (advanced: driving a map yourself, or a custom engine) */
export { applyCameraFrame, canvasHeightPx, fovForDigitalZoom, setMapFov } from "./three/applyCamera";
export type { ApplyCameraOptions, CameraSolverMap } from "./three/applyCamera";
export { clearScreenProjection, hasScreenProjection, publishScreenProjection, screenOf } from "./three/screenProjection";

/* demo/dev helper: real moving pose6 values without a live feed */
export { useSimulatedTraffic } from "./useSimulatedTraffic";
export type { UseSimulatedTrafficOptions } from "./useSimulatedTraffic";

export * from "@radium-engine/core";