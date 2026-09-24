// src/three/MapLibreEngine.tsx — the 3D engine: MapLibre + three.js overlays.
//
// Stylesheet: import it in YOUR entry file — "maplibre-gl/dist/maplibre-gl.css".
// The library deliberately does not deep-import a peer dependency's CSS, so a
// consumer with leaflet/maplibre resolved elsewhere never sees a resolution error.
import { useEffect, useRef, type CSSProperties } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMapEngine } from "../context";
import type { LinesLayer } from "./linesLayer";
import type { MarkersLayer } from "./markersLayer";
import { buildPolygonGeoJson } from "./markersContent";
import { applyTerrain, bindEngineHandlers, createRadiumMap, mountSceneLayers, trackHillshade } from "./mapSetup";

export type MapLibreEngineProps = { className?: string; style?: CSSProperties };

export function MapLibreEngine({ className, style }: MapLibreEngineProps) {
  const { imagery, terrain, pipeline, camera, setCamera, api, store, options, elevation, setReady } = useMapEngine();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const linesRef = useRef<LinesLayer | null>(null);
  const markersRef = useRef<MarkersLayer | null>(null);
  const exaggeration = options.exaggeration ?? 1;

  /* the ground as RENDERED: markers and drop lines use it as their floor */
  const groundAt = (lat: number, lon: number) =>
    elevation ? elevation.surface(lat, lon, terrain ? exaggeration : 1) : 0;

  /* ── map + style (recreated only when provider/pipeline changes) ──── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = createRadiumMap({
      container,
      imagery,
      terrain,
      pipeline,
      center: { lat: camera.lat, lon: camera.lon, zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing },
      attribution: !!options.attribution,
      defaultPitch: options.defaultPitch ?? 60,
    });
    mapRef.current = map;

    const mount = () => {
      const layers = mountSceneLayers(map, {
        store,
        pipeline,
        groundAt,
        dropLines: (options as any).dropLines !== false,
      });
      if (!layers) return;
      linesRef.current = layers.lines;
      markersRef.current = layers.markers;
      setReady(true);
    };

    map.on("load", mount);
    map.on("styledata", mount);

    const sync = () => {
      const center = map.getCenter();
      setCamera({
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    };
    map.on("moveend", sync);
    map.on("zoomend", sync);

    bindEngineHandlers(map, api);
    const stopHillshade = trackHillshade(map);

    return () => {
      stopHillshade();
      map.off("load", mount);
      map.off("styledata", mount);
      map.off("moveend", sync);
      map.off("zoomend", sync);
      map.remove();
      mapRef.current = null;
      linesRef.current = null;
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, imagery.id, !!terrain]);

  /* ── camera set from outside (2D -> 3D flip, flyTo from the API) ──── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const drift = Math.abs(center.lat - camera.lat) + Math.abs(center.lng - camera.lon);
    if (drift < 1e-9 && Math.abs(map.getZoom() - camera.zoom) < 0.01) return;
    map.jumpTo({
      center: [camera.lon, camera.lat],
      zoom: camera.zoom,
      pitch: Math.max(0, Math.min(85, camera.pitch ?? options.defaultPitch ?? 60)),
      bearing: camera.bearing ?? map.getBearing(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.lat, camera.lon, camera.zoom, camera.pitch]);

  /* ── terrain (only when the configuration really changed) ─────────── */
  const appliedTerrain = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = terrain ? `${terrain.folder}:${exaggeration}` : "off";
    if (appliedTerrain.current === key) return;
    appliedTerrain.current = key;
    applyTerrain(map, terrain, exaggeration);
  }, [terrain?.folder, exaggeration, terrain]);

  /* ── scene -> layers; repaint only while something is moving ──────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let raf = 0;
    const paint = () => {
      const source = map.getSource("shapes") as any;
      if (source?.setData) source.setData(buildPolygonGeoJson(store));
      linesRef.current?.sync();
      markersRef.current?.sync();
      map.triggerRepaint();
    };

    const tick = () => {
      linesRef.current?.sync();
      markersRef.current?.sync();
      map.triggerRepaint();
      raf = store.active ? requestAnimationFrame(tick) : 0;
    };

    paint();
    const unsubscribe = store.subscribe(() => {
      paint();
      if (store.active && !raf) raf = requestAnimationFrame(tick);
    });

    /* warm the elevations of what is on screen so floors are correct */
    if (elevation) {
      const points = [
        ...store.snapshot().objects.map((spec) => ({ lat: spec.pose6.lat, lon: spec.pose6.lon })),
        ...store.snapshot().shapes.flatMap((shape) =>
          shape.kind === "polyline" ? shape.points.map((point) => ({ lat: point.lat, lon: point.lon })) : [],
        ),
      ];
      if (points.length) void elevation.ensure(points);
    }

    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [store, elevation]);

  return (
    <div
      ref={containerRef}
      className={className ?? "radium-engine-map"}
      style={{ height: "100%", width: "100%", ...style }}
    />
  );
}
