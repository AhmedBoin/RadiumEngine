// src/three/markersContent.ts — DOM marker content: 2D icons in a 3D world.
//
// An object keeps the SAME icon it has in 2D (SVG, HTML or an image), so flipping
// engines shows the same thing, plus its yaw rotation. Objects can also be drawn
// as real three.js models (modelsLayer) — this is the cheap, always correct
// default that works with any icon an application already has.
import type { SceneStore } from "@radium-engine/core";
import type { MarkerContent } from "./markersLayer";

export type MarkerContentOptions = {
  /** rendered ground (terrain-exaggeration aware) used as the floor */
  groundAt: (lat: number, lon: number) => number;
  /** vertical drop line from every object down to the ground */
  dropLines?: boolean;
};

const DEFAULT_ICON = (color: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 40 40">
     <circle cx="20" cy="20" r="9" fill="${color}" stroke="#ffffff" stroke-width="2"/>
     <path d="M20 3 L25 15 L20 12 L15 15 Z" fill="${color}" stroke="#ffffff" stroke-width="1"/>
   </svg>`;

function iconHtml(model: any, color: string, size: number): string {
  if (!model) return DEFAULT_ICON(color, size);
  if (model.kind === "icon" && model.src) {
    return `<img src="${model.src}" style="width:${size}px;height:${size}px;display:block" />`;
  }
  if (model.html) return model.html;
  return DEFAULT_ICON(color, size);
}

/** DOM markers: objects (with the 2D icon), labels and ad-hoc markers. */
export function buildMarkers(store: SceneStore, options: MarkerContentOptions): MarkerContent[] {
  const markers: MarkerContent[] = [];

  for (const spec of store.snapshot().objects) {
    if (spec.visible === false) continue;
    const model: any = spec.model;
    const size = Math.max(16, model?.pixels ?? model?.widthPx ?? spec.pixels ?? 64);
    const color = (spec as any).color ?? "#ff0000";
    const poseOf = () => store.displayPose(spec.id) ?? spec.pose6;

    markers.push({
      id: `object-${spec.id}`,
      html: iconHtml(model, color, size),
      width: size,
      height: size,
      zIndex: (spec as any).zIndex ?? 60,
      /* the store decides smooth vs jump, so 2D and 3D move identically */
      position: () => {
        const pose = poseOf();
        return { lat: pose.lat, lon: pose.lon, alt: pose.alt };
      },
      rotationDeg: poseOf().yaw,
      /* never sink into the rendered terrain */
      floor: () => options.groundAt(poseOf().lat, poseOf().lon) + 1,
    });
  }

  for (const shape of store.snapshot().shapes) {
    if (shape.kind === "label") {
      markers.push({
        id: `label-${shape.id}`,
        html: `<div style="font:600 ${shape.style?.fontSizePx ?? 12}px/1.2 system-ui;background:${
          shape.style?.background ?? "rgba(0,0,0,0.6)"
        };color:${shape.style?.color ?? "#fff"};padding:2px 6px;border-radius:4px;white-space:nowrap">${shape.text}</div>`,
        width: 0,
        height: 0,
        anchorX: 0,
        anchorY: 0,
        zIndex: 55,
        position: () => ({ lat: shape.pose.lat, lon: shape.pose.lon, alt: shape.pose.alt }),
      });
    } else if (shape.kind === "marker") {
      const size = shape.model.kind === "icon" ? shape.model.widthPx ?? 32 : 32;
      markers.push({
        id: `marker-${shape.id}`,
        html: iconHtml(shape.model, "#ffffff", size),
        width: size,
        height: size,
        rotationDeg: shape.rotationDeg ?? 0,
        zIndex: shape.style?.zIndex ?? 40,
        position: () => ({ lat: shape.pose.lat, lon: shape.pose.lon, alt: shape.pose.alt }),
      });
    }
  }

  return markers;
}

/** Polygon GeoJSON for the fill / extrusion layers of the style. */
export function buildPolygonGeoJson(store: SceneStore) {
  const features: any[] = [];

  for (const shape of store.snapshot().shapes) {
    if (shape.kind !== "polygon" || shape.points.length < 3) continue;
    const style: any = shape.style ?? {};
    features.push({
      type: "Feature",
      properties: {
        color: typeof style.color === "number" ? `#${style.color.toString(16).padStart(6, "0")}` : style.color ?? "#22a34a",
        opacity: style.opacity ?? 0.15,
        height: style.extrudeM ?? 0,
        base: style.baseM ?? 0,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [...shape.points.map((p: { lat: number; lon: number }) => [p.lon, p.lat]), [shape.points[0].lon, shape.points[0].lat]],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}
