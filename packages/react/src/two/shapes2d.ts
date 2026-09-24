// src/two/shapes2d.ts — drawing primitives of the 2D engine.
import type { ShapeSpec } from "@radium-engine/core";
import L from "leaflet";

export function normalizeColor(color: string | number): string {
  if (typeof color === "number") return `#${color.toString(16).padStart(6, "0")}`;
  return color;
}

/** Create or update the Leaflet layer of one drawing primitive. */
export function renderShape(shape: ShapeSpec, existing: L.Layer | undefined): L.Layer {
  const style: any = (shape as any).style ?? {};

  switch (shape.kind) {
    case "polyline": {
      const latlngs = shape.points.map((p) => [p.lat, p.lon] as [number, number]);
      if (existing instanceof L.Polyline && !(existing instanceof L.Polygon)) {
        existing.setLatLngs(latlngs);
        existing.setStyle({
          color: normalizeColor(style.color ?? "#eeff00"),
          weight: style.widthPx ?? 3,
          opacity: style.opacity ?? 1,
        });
        return existing;
      }
      return L.polyline(latlngs, {
        color: normalizeColor(style.color ?? "#eeff00"),
        weight: style.widthPx ?? 3,
        opacity: style.opacity ?? 1,
        dashArray: style.dashed ? `${style.dashPx ?? 6} ${style.gapPx ?? 5}` : undefined,
        interactive: false,
      });
    }

    case "polygon": {
      const latlngs = shape.points.map((p) => [p.lat, p.lon] as [number, number]);
      if (existing instanceof L.Polygon) {
        existing.setLatLngs(latlngs);
        existing.setStyle({
          color: normalizeColor(style.color ?? "#22a34a"),
          fillColor: normalizeColor(style.color ?? "#22a34a"),
          fillOpacity: style.opacity ?? 0.15,
        });
        return existing;
      }
      return L.polygon(latlngs, {
        color: normalizeColor(style.color ?? "#22a34a"),
        weight: style.widthPx ?? 3,
        fillColor: normalizeColor(style.color ?? "#22a34a"),
        fillOpacity: style.opacity ?? 0.15,
        interactive: false,
      });
    }

    case "circle": {
      if (existing instanceof L.Circle) {
        existing.setLatLng([shape.center.lat, shape.center.lon]);
        existing.setRadius(shape.radiusM);
        return existing;
      }
      return L.circle([shape.center.lat, shape.center.lon], {
        radius: shape.radiusM,
        color: normalizeColor(style.color ?? "#22a34a"),
        weight: style.widthPx ?? 2.5,
        fillColor: normalizeColor(style.color ?? "#22a34a"),
        fillOpacity: style.opacity ?? 0.08,
        interactive: false,
      });
    }

    case "label": {
      const icon = L.divIcon({
        className: "radium-engine-label",
        html: `<div style="font:600 ${style.fontSizePx ?? 12}px/1.2 system-ui;background:${
          style.background ?? "rgba(0,0,0,0.6)"
        };color:${style.color ?? "#fff"};padding:2px 6px;border-radius:4px;white-space:nowrap">${shape.text}</div>`,
        iconSize: [0, 0],
      });
      if (existing instanceof L.Marker) {
        existing.setLatLng([shape.pose.lat, shape.pose.lon]);
        existing.setIcon(icon);
        return existing;
      }
      return L.marker([shape.pose.lat, shape.pose.lon], { icon, interactive: false });
    }

    case "marker": {
      const size = shape.model.kind === "icon" ? shape.model.widthPx ?? 32 : 32;
      const container = document.createElement("div");
      container.innerHTML = (shape.model as any).html ?? (shape.model as any).src
        ? `<img src="${(shape.model as any).src}" style="width:${size}px;height:${size}px" />`
        : "";
      const icon = L.divIcon({
        className: "radium-engine-marker",
        html: container,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      if (existing instanceof L.Marker) {
        existing.setLatLng([shape.pose.lat, shape.pose.lon]);
        existing.setIcon(icon);
        return existing;
      }
      return L.marker([shape.pose.lat, shape.pose.lon], {
        icon,
        interactive: !!(shape.style as any)?.interactive,
      });
    }

    case "dropLine":
      /* a drop line is a 3D concept (altitude above ground); in 2D it is the
         object's own position, so nothing extra is drawn */
      return existing ?? L.layerGroup();
  }
}
