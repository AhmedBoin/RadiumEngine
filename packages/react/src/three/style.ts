// src/three/style.ts — the MapLibre style RadiumEngine builds for 3D mode.
//
// basemap (cached imagery) + optional raster-dem terrain + optional hillshade.
// Every tile goes through radium://, i.e. through the shared cache.
import { demTileSource, imageryTileSource, radiumTileUrl, registerTileSource } from "./protocol";
import type { DemSource, ImageryProvider, TilePipeline } from "@radium-engine/core";

export type StyleOptions = {
  imagery: ImageryProvider;
  terrain: DemSource | null;
  pipeline: TilePipeline | null;
  /** CSS background used before the first tile arrives. */
  background?: string;
};

export function buildRadiumStyle(options: StyleOptions) {
  const imagerySource = registerTileSource(imageryTileSource(options.imagery));
  const sources: Record<string, unknown> = {
    basemap: {
      type: "raster",
      tiles: [radiumTileUrl("tiles", imagerySource.folder!)],
      tileSize: imagerySource.tileSize ?? 256,
      maxzoom: imagerySource.maxZoom ?? 19,
      scheme: "xyz",
      attribution: options.imagery.attribution ?? "",
    },
  };

  const layers: any[] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": options.background ?? "#0b0d12" },
    },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: { "raster-resampling": "linear", "raster-fade-duration": 0 },
    },
  ];

  /* filled / extruded polygons always exist, so the engine can push into them */
  sources.shapes = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  layers.push(
    {
      id: "shapes-fill",
      type: "fill",
      source: "shapes",
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] },
    },
    {
      id: "shapes-extrusion",
      type: "fill-extrusion",
      source: "shapes",
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-opacity": 0.35,
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "base"],
      },
    },
  );

  if (options.terrain) {
    const demSource = registerTileSource(demTileSource(options.terrain));
    sources.dem = {
      type: "raster-dem",
      tiles: [radiumTileUrl("dem", demSource.folder!)],
      tileSize: demSource.tileSize ?? 256,
      encoding: demSource.encoding ?? "terrarium",
      maxzoom: demSource.maxZoom ?? 15,
    };
    /* hillshade is a full extra pass over the DEM: the engine hides it while the
       camera moves so panning and tilting stay smooth */
    layers.push({
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-exaggeration": 0.35,
        "hillshade-shadow-color": "rgba(0,0,0,0.5)",
        "hillshade-highlight-color": "rgba(255,255,255,0.22)",
        "hillshade-accent-color": "rgba(0,0,0,0.25)",
      },
    });
    /* a place for filled polygons / extruded volumes (added by the engine) */
    sources.shapes = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    layers.push(
      { id: "shapes-fill", type: "fill", source: "shapes", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] } },
      {
        id: "shapes-extrusion",
        type: "fill-extrusion",
        source: "shapes",
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-opacity": 0.35,
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["get", "base"],
        },
      },
    );
  }

  return {
    version: 8,
    name: "RadiumEngine",
    sources,
    layers,
    sky: {
      "sky-color": "#0a1a2f",
      "horizon-color": "#8fb6d6",
      "fog-color": "#9fb4c8",
      "fog-ground-blend": 0.2,
    },
  } as any;
}
