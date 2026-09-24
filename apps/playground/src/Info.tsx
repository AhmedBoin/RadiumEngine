// src/Info.tsx — what the interaction layer gives an application, on one panel.
//
// Nothing here talks to Leaflet or MapLibre: `usePointer()` is the cursor position, `useHovered()`
// is what is under it, `useSelection()` is what is selected (in 2D AND 3D, unchanged by a flip),
// and the measurement helpers are plain maths from @radium-engine/core.
import { formatArea, formatDistance, pathLengthM, polygonAreaM2, useHovered, usePointer, useSelection } from "@radium-engine/react";
import { FENCE, MISSION_PATH } from "./scenario";

function row(label: string, value: string) {
  return (
    <div className="status">
      <strong>{label}</strong> {" "}
      <span style={{ opacity: 0.85 }}>{value}</span>
    </div>
  );
}

export function Info() {
  const pointer = usePointer();
  const hovered = useHovered();
  const selection = useSelection();

  return (
    <>
      <div className="maptap-section-header">Interaction</div>
      {row("cursor", pointer ? `${pointer.lat.toFixed(5)}, ${pointer.lon.toFixed(5)}` : "outside the map")}
      {row("hovered", hovered ? `${hovered.kind} ${hovered.id} (${hovered.distancePx.toFixed(1)} px)` : "—")}
      {row("selected", selection.entries.length ? selection.entries.map((entry) => `${entry.kind}:${entry.id}`).join(", ") : "nothing (click an aircraft, a path or the fence)")}
      {row("mission path", `${formatDistance(pathLengthM(MISSION_PATH))} over ${MISSION_PATH.length} waypoints`)}
      {row("fence area", formatArea(polygonAreaM2(FENCE)))}
      <div className="row">
        <button onClick={() => selection.clear()} disabled={selection.entries.length === 0}>
          Clear selection
        </button>
      </div>
    </>
  );
}