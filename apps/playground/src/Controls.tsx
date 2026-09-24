import {
  tilesForBounds,
  useMapApi,
  useMapEngine,
  useMapMode,
  type DemSource,
} from "@radium-engine/react";
import { useCallback, useState } from "react";
import { imageryOptions, terrainOptions, type UiState } from "./scenario";

export function Controls({
  ui,
  update,
}: {
  ui: UiState;
  update: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
}) {
  const [mode, setMode] = useMapMode();
  const api = useMapApi();
  const { pipeline, elevation, imagery, terrain } = useMapEngine();
  const [status, setStatus] = useState("cache: …");
  const [progress, setProgress] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!pipeline) {
      setStatus("cache: disabled");
      return;
    }
    const stats = await pipeline.stats();
    setStatus(`cache: ${stats.adapter} · ${stats.entries} tiles · ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  }, [pipeline]);

  /** Prefetch the visible area: imagery AND terrain, ready for offline use. */
  const prefetch = useCallback(async () => {
    if (!pipeline) return;
    const camera = api.getCamera();
    const span = 0.02;
    const bounds = {
      west: camera.lon - span,
      east: camera.lon + span,
      south: camera.lat - span,
      north: camera.lat + span,
    };

    setProgress("prefetching imagery…");
    await pipeline.prefetch(
      { id: imagery.id, url: imagery.url, subdomains: imagery.subdomains, maxZoom: imagery.maxZoom ?? 19 },
      tilesForBounds(bounds, Math.floor(camera.zoom), Math.floor(camera.zoom) + 1, 4000),
      { onProgress: (p) => setProgress(`imagery ${p.done}/${p.total} (${p.downloaded} new, ${p.cached} cached)`) },
    );

    if (terrain) {
      setProgress("prefetching terrain…");
      await pipeline.prefetch(
        terrain as DemSource,
        tilesForBounds(bounds, Math.min(11, terrain.maxZoom), Math.min(13, terrain.maxZoom), 2000),
        { onProgress: (p) => setProgress(`terrain ${p.done}/${p.total} (${p.downloaded} new, ${p.cached} cached)`) },
      );
    }

    setProgress("prefetch complete");
    void refreshStatus();
  }, [api, pipeline, imagery, terrain, refreshStatus]);

  const groundHeight = useCallback(async () => {
    if (!elevation) return;
    const camera = api.getCamera();
    const value = await elevation.at(camera.lat, camera.lon);
    setProgress(value == null ? "elevation: unavailable" : `ground at centre: ${value.toFixed(1)} m MSL`);
  }, [api, elevation]);

  return (
    <>
      <div className="row">
        <button
          className={mode === "2d" ? "on" : ""}
          onClick={() => {
            setMode("2d");
            update("mode", "2d");
          }}
        >
          2D
        </button>
        <button
          className={mode === "3d" ? "on" : ""}
          onClick={() => {
            setMode("3d");
            update("mode", "3d");
          }}
        >
          3D
        </button>
        <button onClick={() => api.flyTo({ lat: 30.0444, lon: 31.2357, zoom: 12, pitch: 0 }, { durationMs: 1200 })}>
          Fly home
        </button>
      </div>

      <label>
        Imagery
        <select value={ui.imagery} onChange={(event) => update("imagery", event.target.value)}>
          {imageryOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Terrain
        <select value={ui.terrain} onChange={(event) => update("terrain", event.target.value)}>
          {terrainOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={ui.terrainEnabled}
            onChange={(event) => update("terrainEnabled", event.target.checked)}
          />
          terrain
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={ui.dropLines}
            onChange={(event) => update("dropLines", event.target.checked)}
          />
          drop lines
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={ui.motion === "smooth"}
            onChange={(event) => update("motion", event.target.checked ? "smooth" : "jump")}
          />
          smooth
        </label>
      </div>

      <label>
        Terrain smoothing: {ui.smoothing}
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={ui.smoothing}
          onChange={(event) => update("smoothing", Number(event.target.value))}
        />
      </label>

      <label>
        Exaggeration: {ui.exaggeration.toFixed(1)}×
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={ui.exaggeration}
          onChange={(event) => update("exaggeration", Number(event.target.value))}
        />
      </label>

      <label>
        Aircraft: {ui.objects}
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={ui.objects}
          onChange={(event) => update("objects", Number(event.target.value))}
        />
      </label>

      <div className="row">
        <button onClick={() => void prefetch()}>Prefetch area</button>
        <button onClick={() => void refreshStatus()}>Cache stats</button>
        <button onClick={() => void groundHeight()}>Ground height</button>
      </div>

      <div className="status">{status}</div>
      <div className="status">{progress}</div>
    </>
  );
}
