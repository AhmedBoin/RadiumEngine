import {
  MapProvider,
  MapView,
  type MapEngineOptions,
} from "@radium-engine/react";
import { useCallback, useMemo, useState } from "react";
import { Controls } from "./Controls";
import { Scene } from "./Scene";
import type { UiState } from "./scenario";

export function App() {
  const [ui, setUi] = useState<UiState>({
    mode: "3d",
    imagery: "ESRI.WorldImagery",
    terrain: "aws-terrarium",
    terrainEnabled: true,
    smoothing: 1,
    exaggeration: 1.3,
    motion: "smooth",
    dropLines: true,
    objects: 3,
  });

  const update = useCallback(<K extends keyof UiState>(key: K, value: UiState[K]) => {
    setUi((current) => ({ ...current, [key]: value }));
  }, []);

  const options = useMemo<MapEngineOptions>(
    () => ({
      mode: ui.mode,
      imagery: ui.imagery,
      terrain: ui.terrainEnabled ? { provider: ui.terrain, smoothing: ui.smoothing } : false,
      exaggeration: ui.exaggeration,
      camera: { lat: 30.0521, lon: 31.2522, zoom: 13.4, pitch: 58 },
      cache: { kind: "auto", rootDir: "RadiumEngine/tiles" },
    }),
    [ui.mode, ui.imagery, ui.terrain, ui.terrainEnabled, ui.smoothing, ui.exaggeration],
  );

  return (
    <MapProvider options={options}>
      <div className="layout">
        <MapView className="map" />
        <div className="panel">
          <h1>RadiumEngine</h1>
          <p className="hint">One scene, two engines: flip 2D / 3D and everything stays in place.</p>
          <Controls ui={ui} update={update} />
          <Scene ui={ui} />
        </div>
      </div>
    </MapProvider>
  );
}
