import {
  FollowCamera,
  MapObject,
  MapProvider,
  MapView,
  Track,
  useSettings,
  useSimulatedTraffic,
  type MapEngineOptions,
} from "@radium-engine/react";
import { useMemo } from "react";

/**
 * The starter app: a persisted 2D/3D map, a moving object, and a camera that follows it.
 *
 * Everything the user can change here — the mode, the camera mode, the framing — is
 * stored (a file inside Tauri, `localStorage` in a browser) and comes back on the next
 * launch. Note the `if (!loaded)` guard: mounting the map before the stored document has
 * been read would save the defaults over it (`docs/17-settings.md`).
 */
type Settings = {
  mode: "2d" | "3d";
  follow: boolean;
  cameraMode: "free" | "follow" | "chase" | "fpv";
  screenFractionPct: number;
};

const DEFAULTS: Settings = {
  mode: "3d",
  follow: true,
  cameraMode: "chase",
  screenFractionPct: 55,
};

export function App() {
  const { settings, loaded, status, set, reset } = useSettings<Settings>({
    defaults: DEFAULTS,
    key: "my-map-app.json",
  });

  const options = useMemo<MapEngineOptions>(
    () => ({
      mode: settings.mode,
      imagery: "ESRI.WorldImagery",
      terrain: { provider: "aws-terrarium", smoothing: 1 },
      exaggeration: 1.2,
      camera: { lat: 30.0444, lon: 31.2357, zoom: 13, pitch: 55 },
      /* tiles are cached here and reused offline (Tauri: fs, browser: IndexedDB) */
      cache: { kind: "auto", rootDir: "MyApp/tiles" },
    }),
    [settings.mode],
  );

  const traffic = useSimulatedTraffic(true, 1);
  const followed = traffic[0]?.id ?? null;

  if (!loaded) return <div style={{ position: "fixed", inset: 0 }}>loading settings…</div>;

  return (
    <MapProvider options={options}>
      <div style={{ position: "fixed", inset: 0 }}>
        <MapView />

        {/* the camera: one component, every mode (docs/16-camera.md) */}
        <FollowCamera
          target={settings.follow ? followed : null}
          mode={settings.cameraMode}
          tuning={{ screenFractionPct: settings.screenFractionPct, chasePitchDeg: 42 }}
        />

        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, display: "grid", gap: 6 }}>
          <button onClick={() => set({ mode: settings.mode === "2d" ? "3d" : "2d" })}>
            Switch to {settings.mode === "2d" ? "3D" : "2D"}
          </button>
          <select
            value={settings.cameraMode}
            onChange={(event) => set({ cameraMode: event.target.value as Settings["cameraMode"] })}
          >
            <option value="free">Free camera</option>
            <option value="follow">Follow</option>
            <option value="chase">Chase</option>
            <option value="fpv">FPV</option>
          </select>
          <label style={{ color: "#fff", font: "12px system-ui" }}>
            object on screen {settings.screenFractionPct}%
            <input
              type="range"
              min={20}
              max={80}
              step={5}
              value={settings.screenFractionPct}
              onChange={(event) => set({ screenFractionPct: Number(event.target.value) })}
            />
          </label>
          <button onClick={() => reset()}>Reset settings</button>
          <span style={{ color: "#fff", font: "11px system-ui", opacity: 0.7 }}>{status.adapter}</span>
        </div>
      </div>

      {traffic.map((item) => (
        <MapObject key={item.id} id={item.id} pose6={item.pose6} motion={{ mode: "smooth" }} dropLine />
      ))}
      {traffic.map((item) => (
        <Track key={item.id} id={item.id} maxSeconds={120} style={{ color: "#ffd400", widthPx: 6 }} />
      ))}
    </MapProvider>
  );
}
