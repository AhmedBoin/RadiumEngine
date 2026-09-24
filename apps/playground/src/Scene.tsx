// src/Scene.tsx — pure declaration: the SAME tree is rendered by both engines.
import {
  Circle,
  Label,
  MapObject,
  Polygon,
  Polyline,
  useSimulatedTraffic,
} from "@radium-engine/react";
import { useMemo } from "react";
import { FENCE, ICON_AIRCRAFT, MISSION_PATH, type UiState } from "./scenario";

const MAX_SECONDS = 60;
const TRACK_COLORS = ["#ffd400", "#00e5ff", "#ff7ae0", "#7cff6b"];

export function Scene({ ui }: { ui: UiState }) {
  const traffic = useSimulatedTraffic(true, ui.objects);
  const fenceCenter = useMemo(() => ({ lat: 30.0545, lon: 31.2505 }), []);

  return (
    <>
      {traffic.map((item, index) => (
        <MapObject
          key={item.id}
          id={item.id}
          pose6={item.pose6}
          model={{ kind: "icon", html: ICON_AIRCRAFT, widthPx: 48, heightPx: 48 }}
          motion={{ mode: ui.motion, lagMs: 280 }}
          dropLine={ui.dropLines}
          track={{
            maxSeconds: MAX_SECONDS,
            style: { color: TRACK_COLORS[index % TRACK_COLORS.length], widthPx: 6, smoothing: 1 },
          }}
        />
      ))}

      <Polyline id="mission" points={MISSION_PATH} style={{ color: "#ffd400", widthPx: 4 }} />
      {MISSION_PATH.map((point, index) => (
        <Label
          key={index}
          id={`wp-${index}`}
          pose={point}
          text={`WP${index + 1}`}
          style={{ background: "rgba(0,0,0,0.65)" }}
        />
      ))}

      <Polygon id="fence" points={FENCE} style={{ color: "#22a34a", opacity: 0.18, widthPx: 3, extrudeM: 120 }} />
      <Circle id="geofence" center={fenceCenter} radiusM={900} style={{ color: "#00e5ff", widthPx: 2.5 }} />
    </>
  );
}
