// src/two/LeafletEngine.tsx — the 2D engine: Leaflet + the shared tile cache.
//
// Stylesheet: the library NEVER imports a peer dependency's CSS itself (a deep
// import like "leaflet/dist/leaflet.css" only resolves when the consumer's
// bundler happens to find leaflet, which is exactly how you get
// "Failed to resolve import ... does not exist"). Import it in YOUR entry file:
//
//   import "leaflet/dist/leaflet.css";        // 2D
//   import "maplibre-gl/dist/maplibre-gl.css"; // 3D
//
import L from "leaflet";
import { useEffect, useRef, type CSSProperties } from "react";
import { useMapEngine } from "../context";
import { createCachedTileLayer } from "./tileLayer";
import type { ObjectMarker } from "./objectLayer";
import { renderObjects, renderShapes, renderTracks } from "./sceneSync";

export type LeafletEngineProps = {
  className?: string;
  style?: CSSProperties;
};

export function LeafletEngine({ className, style }: LeafletEngineProps) {
  const { imagery, pipeline, camera, setCamera, api, store, options, setReady } = useMapEngine();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const objectsRef = useRef(new Map<string, ObjectMarker>());
  const shapesRef = useRef(new Map<string, L.Layer>());
  const tracksRef = useRef(new Map<string, L.Polyline>());

  /* ── map + cached imagery ─────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: [camera.lat, camera.lon],
      zoom: camera.zoom,
      zoomControl: true,
      attributionControl: options.attribution,
      preferCanvas: true,
    });
    mapRef.current = map;

    const layer = pipeline
      ? createCachedTileLayer({ pipeline, provider: imagery })
      : L.tileLayer(imagery.url, {
          subdomains: (imagery.subdomains as string[]) ?? [],
          attribution: imagery.attribution,
          maxZoom: 24,
          maxNativeZoom: imagery.maxZoom ?? 19,
        });
    layer.addTo(map);

    const sync = () => {
      const center = map.getCenter();
      setCamera({ lat: center.lat, lon: center.lng, zoom: map.getZoom(), pitch: 0 });
    };
    map.on("moveend", sync);
    map.on("zoomend", sync);

    api.bind({
      flyTo: (target, flyOptions) =>
        map.flyTo([target.lat, target.lon], target.zoom ?? map.getZoom(), {
          duration: (flyOptions?.durationMs ?? 800) / 1000,
        }),
      fitBounds: (bounds, fitOptions) =>
        map.fitBounds(
          [
            [bounds.south, bounds.west],
            [bounds.north, bounds.east],
          ],
          {
            padding: [fitOptions?.paddingPx ?? 40, fitOptions?.paddingPx ?? 40],
            animate: (fitOptions?.durationMs ?? 0) > 0,
          },
        ),
      getCamera: () => {
        const center = map.getCenter();
        return { lat: center.lat, lon: center.lng, zoom: map.getZoom(), pitch: 0 };
      },
      getEngineMap: () => map,
    });

    setReady(true);
    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      objectsRef.current.clear();
      shapesRef.current.clear();
      tracksRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline, imagery.id, options.attribution]);

  /* ── camera set from outside (3D -> 2D flip, or flyTo from the API) ─ */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const same =
      Math.abs(center.lat - camera.lat) < 1e-7 &&
      Math.abs(center.lng - camera.lon) < 1e-7 &&
      Math.abs(map.getZoom() - camera.zoom) < 0.01;
    if (!same) map.setView([camera.lat, camera.lon], camera.zoom, { animate: false });
  }, [camera.lat, camera.lon, camera.zoom]);

  /* ── scene: objects, shapes, tracks ───────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      renderObjects(map, store, objectsRef.current);
      renderShapes(map, store, shapesRef.current);
      renderTracks(map, store, tracksRef.current);
    };

    render();
    const unsubscribe = store.subscribe(render);
    const stopTicking = store.poseStore.subscribe(render);
    return () => {
      unsubscribe();
      stopTicking();
    };
  }, [store]);

  return (
    <div
      ref={containerRef}
      className={className ?? "radium-engine-map"}
      style={{ height: "100%", width: "100%", ...style }}
    />
  );
}
