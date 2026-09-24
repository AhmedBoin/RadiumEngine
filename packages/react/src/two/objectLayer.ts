// src/two/objectLayer.ts — how a MapObject looks in 2D (a rotated icon marker).
import type { MapObjectSpec, ModelSpec, Pose6 } from "@radium-engine/core";
import L from "leaflet";

export type ObjectMarker = {
  marker: L.Marker;
  /** the element inside the marker that carries the rotation */
  rotator: HTMLElement;
  signature: string;
};

/** Default pin used when an object has no icon of its own. */
const DEFAULT_ICON = (color = "#ff0000") =>
  `<svg width="40" height="40" viewBox="0 0 40 40">
     <circle cx="20" cy="20" r="9" fill="${color}" stroke="#ffffff" stroke-width="2" opacity="0.95"/>
     <path d="M20 3 L25 15 L20 12 L15 15 Z" fill="${color}" stroke="#ffffff" stroke-width="1"/>
   </svg>`;

function iconHtml(model: ModelSpec | undefined, color: string): { html: string; size: number } {
  if (!model) return { html: DEFAULT_ICON(color), size: 40 };
  if (model.kind === "icon" || model.kind === "icon3d") {
    if (model.kind === "icon" && model.src) {
      const size = model.widthPx ?? model.heightPx ?? 40;
      return { html: `<img src="${model.src}" style="width:${size}px;height:${size}px;display:block" />`, size };
    }
    const html = (model as any).html as string | undefined;
    if (html) return { html, size: model.kind === "icon" ? model.widthPx ?? 64 : (model.pixels ?? 64) };
    return { html: DEFAULT_ICON(color), size: (model as any).pixels ?? 40 };
  }
  /* glb models have no 2D representation: draw the default pin */
  return { html: DEFAULT_ICON(color), size: 40 };
}

/** Create (or recreate) the marker for an object. */
export function createObjectMarker(spec: MapObjectSpec, pose: Pose6): ObjectMarker {
  const color = (spec as any).color ?? "#ff0000";
  const { html, size } = iconHtml(spec.model, color);

  const container = document.createElement("div");
  container.style.width = `${size}px`;
  container.style.height = `${size}px`;
  container.style.display = "block";

  const rotator = document.createElement("div");
  rotator.style.width = "100%";
  rotator.style.height = "100%";
  rotator.style.transformOrigin = "50% 50%";
  rotator.innerHTML = html;
  container.appendChild(rotator);

  const icon = L.divIcon({
    className: "radium-engine-object",
    html: container,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  const marker = L.marker([pose.lat, pose.lon], {
    icon,
    interactive: (spec as any).interactive ?? false,
    zIndexOffset: (spec as any).zIndex ?? 1000,
  });

  const signature = `${html}|${size}|${color}`;
  return { marker, rotator, signature };
}

/** Apply a pose (position + yaw) to an existing marker. */
export function updateObjectMarker(
  object: ObjectMarker,
  spec: MapObjectSpec,
  pose: Pose6,
): void {
  object.marker.setLatLng([pose.lat, pose.lon]);
  object.rotator.style.transform = `rotate(${pose.yaw}deg)`;
  void spec;
}

/** True when the icon of an object changed (so the marker must be rebuilt). */
export function objectSignatureChanged(object: ObjectMarker, spec: MapObjectSpec): boolean {
  const { html, size } = iconHtml(spec.model, (spec as any).color ?? "#ff0000");
  return object.signature !== `${html}|${size}|${(spec as any).color ?? "#ff0000"}`;
}
