// src/three/mapSetup.ts — the imperative half of the 3D engine.
//
// Keeping map creation, handler binding, terrain switching and hillshade
// throttling here (instead of inside the React component) makes the component a
// thin declarative shell, exactly like the rest of RadiumEngine.
import type { DemSource, ImageryProvider, SceneStore, TilePipeline } from "@radium-engine/core";
import { Map as MapLibreMap } from "maplibre-gl";
import type { MapApi } from "../context";
import { createLinesLayer, type LinesLayer } from "./linesLayer";
import { createMarkersLayer, type MarkersLayer } from "./markersLayer";
import { registerRadiumProtocol } from "./protocol";
import { buildDropLines, buildLines } from "./sceneContent";
import { buildMarkers } from "./markersContent";
import { buildRadiumStyle } from "./style";

export type SceneLayers = { lines: LinesLayer; markers: MarkersLayer };

export type CreateMapOptions = {
  container: HTMLElement;
  imagery: ImageryProvider;
  terrain: DemSource | null;
  pipeline: TilePipeline | null;
  center: { lat: number; lon: number; zoom: number; pitch?: number; bearing?: number };
  attribution: boolean;
  defaultPitch: number;
};

export function createRadiumMap(options: CreateMapOptions): MapLibreMap {
  if (options.pipeline) registerRadiumProtocol(options.pipeline);

  return new MapLibreMap({
    container: options.container,
    style: buildRadiumStyle({
      imagery: options.imagery,
      terrain: options.terrain,
      pipeline: options.pipeline,
    }) as any,
    center: [options.center.lon, options.center.lat],
    zoom: options.center.zoom,
    pitch: Math.max(0, Math.min(85, options.center.pitch ?? options.defaultPitch)),
    bearing: options.center.bearing ?? 0,
    maxPitch: 85,
    maxZoom: 24,
    dragRotate: true,
    pitchWithRotate: true,
    touchPitch: true,
    attributionControl: options.attribution,
    canvasContextAttributes: { antialias: true },
    fadeDuration: 0,
  } as any);
}

/** Wire the imperative `MapApi` to a MapLibre map. */
export function bindEngineHandlers(map: MapLibreMap, api: MapApi): void {
  api.bind({
    flyTo: (target, flyOptions) =>
      map.flyTo({
        center: [target.lon, target.lat],
        zoom: target.zoom ?? map.getZoom(),
        pitch: target.pitch ?? map.getPitch(),
        bearing: target.bearing ?? map.getBearing(),
        duration: flyOptions?.durationMs ?? 900,
      }),
    fitBounds: (bounds, fitOptions) =>
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        {
          padding: fitOptions?.paddingPx ?? 60,
          duration: fitOptions?.durationMs ?? 0,
          pitch: map.getPitch(),
        } as any,
      ),
    getCamera: () => {
      const center = map.getCenter();
      return {
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
    },
    getEngineMap: () => map,
  });
}

export type MountOptions = {
  store: SceneStore;
  pipeline: TilePipeline | null;
  groundAt: (lat: number, lon: number) => number;
  dropLines: boolean;
};

/** Add the overlay layers (idempotent: safe to call on every style event). */
export function mountSceneLayers(map: MapLibreMap, options: MountOptions): SceneLayers | null {
  if (!map.isStyleLoaded() || map.getLayer("radium-engine-lines")) return null;

  const lines = createLinesLayer(
    map,
    {
      lines: () => buildLines(options.store),
      dropLines: () => buildDropLines(options.store, { groundAt: options.groundAt, dropLines: options.dropLines }),
    },
    options.pipeline,
  );
  const markers = createMarkersLayer(map, map.getCanvasContainer(), () =>
    buildMarkers(options.store, { groundAt: options.groundAt, dropLines: options.dropLines }),
  );

  map.addLayer(lines as any);
  map.addLayer(markers as any);
  return { lines, markers };
}

/** Apply (or clear) terrain; safe against a style that is not ready yet. */
export function applyTerrain(map: MapLibreMap, terrain: DemSource | null, exaggeration: number): void {
  try {
    if (terrain && map.getSource("dem")) map.setTerrain({ source: "dem", exaggeration } as any);
    else if (!terrain) map.setTerrain(null as any);
  } catch (error) {
    console.warn("[RadiumEngine] terrain could not be applied", error);
  }
}

/**
 * The hillshade pass is a full extra render of the DEM, so it is hidden while the
 * camera moves: panning and tilting stay smooth on integrated GPUs.
 */
export function trackHillshade(map: MapLibreMap): () => void {
  const toggle = (visible: boolean) => {
    if (!map.getLayer("hillshade")) return;
    try {
      map.setLayoutProperty("hillshade", "visibility", visible ? "visible" : "none");
    } catch {
      /* style not ready */
    }
  };

  const starts = ["movestart", "zoomstart", "rotatestart", "pitchstart"] as const;
  const ends = ["moveend", "zoomend", "rotateend", "pitchend"] as const;
  const hide = () => toggle(false);
  const show = () => toggle(true);

  starts.forEach((event) => map.on(event as any, hide));
  ends.forEach((event) => map.on(event as any, show));

  return () => {
    starts.forEach((event) => map.off(event as any, hide));
    ends.forEach((event) => map.off(event as any, show));
  };
}
