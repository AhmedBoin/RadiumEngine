import { MapObject, MapProvider, MapView, Track, useSimulatedTraffic, type MapEngineOptions } from "@radium-engine/react";
import { useMemo, useState } from "react";

export function App() {
  const [mode, setMode] = useState<"2d" | "3d">("3d");

  const options = useMemo<MapEngineOptions>(
    () => ({
      mode,
      imagery: "ESRI.WorldImagery",
      terrain: { provider: "aws-terrarium", smoothing: 1 },
      exaggeration: 1.2,
      camera: { lat: 30.0444, lon: 31.2357, zoom: 13, pitch: 55 },
      /* tiles are cached here and reused offline (Tauri: fs, browser: IndexedDB) */
      cache: { kind: "auto", rootDir: "MyApp/tiles" },
    }),
    [mode],
  );

  const traffic = useSimulatedTraffic(true, 1);

  return (
    <MapProvider options={options}>
      <div style={{ position: "fixed", inset: 0 }}>
        <MapView />
        <button
          style={{ position: "absolute", top: 12, left: 12, zIndex: 10, padding: "8px 14px" }}
          onClick={() => setMode(mode === "2d" ? "3d" : "2d")}
        >
          Switch to {mode === "2d" ? "3D" : "2D"}
        </button>
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
