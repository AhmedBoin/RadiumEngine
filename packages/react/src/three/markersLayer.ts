// src/three/markersLayer.ts — DOM billboards for the 3D engine.
//
// Objects, labels and 2D markers are HTML elements positioned through MapLibre's
// own projection matrix every frame: constant size, crisp text/HTML, real mouse
// events, and they can sit at any altitude (with an optional ground clearance so
// they never sink into the terrain). three.js sprites cannot do this in a
// MapLibre custom layer, because "view space" there is mercator space.
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

export type MarkerContent = {
  id: string;
  html: string;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
  rotationDeg?: number;
  zIndex?: number;
  /** position each frame (smooth motion or jump) */
  position: () => { lat: number; lon: number; alt: number };
  /** minimum altitude (e.g. the rendered ground) so the marker never sinks */
  floor?: () => number;
};

type Live = {
  element: HTMLElement;
  content: MarkerContent;
  merc: { x: number; y: number; z: number } | null;
  lastX: number;
  lastY: number;
  lastRotation: number;
  lastHtml: string;
};

export type MarkersLayer = CustomLayerInterface & { sync: () => void };

export function createMarkersLayer(
  map: MapLibreMap,
  container: HTMLElement,
  source: () => MarkerContent[],
): MarkersLayer {
  const live = new Map<string, Live>();

  const mercatorFor = (lat: number, lon: number, alt: number) => toMercator(lat, lon, alt);

  const layer: MarkersLayer = {
    id: "radium-engine-markers",
    type: "custom",
    renderingMode: "3d",

    onAdd() {
      /* nothing to set up: this layer only moves DOM elements */
    },

    render(_gl, options) {
      const matrix = options?.defaultProjectionData?.mainMatrix as ArrayLike<number> | undefined;
      if (!matrix || live.size === 0) return;

      const canvas = map.getCanvas();
      const width = canvas.clientWidth || canvas.width || 1;
      const height = canvas.clientHeight || canvas.height || 1;

      for (const entry of live.values()) {
        const position = entry.content.position();
        const floor = entry.content.floor?.() ?? -Infinity;
        const alt = Math.max(position.alt, Number.isFinite(floor) ? floor : -Infinity);
        entry.merc = mercatorFor(position.lat, position.lon, alt);

        const { x, y, z } = entry.merc;
        const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

        if (!Number.isFinite(cw) || cw <= 0) {
          if (entry.element.style.display !== "none") entry.element.style.display = "none";
          continue;
        }

        const screenX = ((cx / cw) * 0.5 + 0.5) * width;
        const screenY = (1 - ((cy / cw) * 0.5 + 0.5)) * height;

        if (screenX < -320 || screenY < -320 || screenX > width + 320 || screenY > height + 320) {
          if (entry.element.style.display !== "none") entry.element.style.display = "none";
          continue;
        }
        if (entry.element.style.display === "none") entry.element.style.display = "block";

        const px = Math.round((screenX - (entry.content.anchorX ?? entry.content.width / 2)) * 100) / 100;
        const py = Math.round((screenY - (entry.content.anchorY ?? entry.content.height / 2)) * 100) / 100;
        const rotation = Math.round((entry.content.rotationDeg ?? 0) * 10) / 10;

        if (px === entry.lastX && py === entry.lastY && rotation === entry.lastRotation) continue;
        entry.lastX = px;
        entry.lastY = py;
        entry.lastRotation = rotation;
        entry.element.style.transform =
          `translate3d(${px}px, ${py}px, 0)` + (rotation ? ` rotate(${rotation}deg)` : "");
      }
    },

    onRemove() {
      live.clear();
    },

    sync() {
      const wanted = new Set<string>();

      for (const content of source()) {
        wanted.add(content.id);
        let entry = live.get(content.id);
        if (!entry) {
          const element = document.createElement("div");
          element.style.position = "absolute";
          element.style.left = "0";
          element.style.top = "0";
          element.style.willChange = "transform";
          element.style.display = "none";
          element.style.pointerEvents = "none";
          element.innerHTML = content.html;
          if (content.zIndex != null) element.style.zIndex = String(content.zIndex);
          container.appendChild(element);

          entry = {
            element,
            content,
            merc: null,
            lastX: Number.NaN,
            lastY: Number.NaN,
            lastRotation: Number.NaN,
            lastHtml: content.html,
          };
          live.set(content.id, entry);
          continue;
        }

        if (entry.lastHtml !== content.html) {
          entry.element.innerHTML = content.html;
          entry.lastHtml = content.html;
        }
        entry.content = content;
        entry.lastX = Number.NaN;
        entry.lastY = Number.NaN;
      }

      for (const [id, entry] of live) {
        if (!wanted.has(id)) {
          entry.element.remove();
          live.delete(id);
        }
      }
    },
  };

  return layer;
}

/* local copy of MapLibre's mercator conversion (no import cycle, no dependency) */
function toMercator(lat: number, lon: number, alt: number) {
  const x = (lon + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  const z = alt / (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180));
  return { x, y, z: alt ? z : 0 };
}
