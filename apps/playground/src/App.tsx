import {
  FollowCamera,
  MapProvider,
  MapView,
  useSettings,
  useSettingsStatus,
  type MapEngineOptions,
} from "@radium-engine/react";
import { useMemo } from "react";
import { Controls } from "./Controls";
import { Info } from "./Info";
import { Scene } from "./Scene";
import { PLAYGROUND_SETTINGS_DEFAULTS, type UiState } from "./scenario";

/**
 * Everything the panel can change is PERSISTED (localStorage here, a real file inside
 * Tauri): the imagery, the terrain, the camera mode, the framing. Reload the page and the
 * app comes back exactly as it was left — which is what `useSettings` is for. Note that
 * nothing renders until `loaded` is true: mounting the map first would save the defaults
 * over the stored document (that is the rule the store enforces, see `settings/store.ts`).
 */
export function App() {
  const { settings: ui, loaded, status, set, reset } = useSettings<UiState>({
    defaults: PLAYGROUND_SETTINGS_DEFAULTS,
    key: "radium-engine-playground.json",
    debounceMs: 200,
  });
  const statusLine = useSettingsStatus(status);

  const update = <K extends keyof UiState>(key: K, value: UiState[K]) => set({ [key]: value } as never);

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

  if (!loaded) return <div className="boot">loading settings…</div>;

  return (
    <MapProvider options={options}>
      <div className="layout">
        <MapView className="map" />
        {/* one declarative line: the camera follows the first simulated aircraft */}
        <FollowCamera
          target={ui.objects > 0 && ui.cameraMode !== "free" ? "uav-1" : null}
          mode={ui.cameraMode}
          tuning={{
            screenFractionPct: ui.screenFractionPct,
            chasePitchDeg: 42,
            fpvModel: "gimbal",
            fpvMountPitchDeg: ui.fpvMountPitchDeg,
          }}
        />
        <div className="panel">
          <h1>RadiumEngine</h1>
          <p className="hint">One scene, two engines: flip 2D / 3D and everything stays in place.</p>
          <Controls ui={ui} update={update} />
          <Scene ui={ui} />
          <Info />
          <div className="status">{statusLine}</div>
          <button onClick={() => reset()}>Reset settings</button>
        </div>
      </div>
    </MapProvider>
  );
}
