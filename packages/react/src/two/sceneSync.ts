// src/two/sceneSync.ts — push the shared scene state into Leaflet layers.
import type { SceneStore } from "@radium-engine/core";
import L from "leaflet";
import {
  createObjectMarker,
  objectSignatureChanged,
  updateObjectMarker,
  type ObjectMarker,
} from "./objectLayer";
import { normalizeColor, renderShape } from "./shapes2d";

export function renderObjects(
  map: L.Map,
  store: SceneStore,
  registry: Map<string, ObjectMarker>,
): void {
  const seen = new Set<string>();

  for (const spec of store.snapshot().objects) {
    if (spec.visible === false) continue;
    seen.add(spec.id);
    const pose = store.displayPose(spec.id) ?? spec.pose6;

    let entry = registry.get(spec.id);
    if (entry && objectSignatureChanged(entry, spec)) {
      entry.marker.removeFrom(map);
      entry = undefined;
    }
    if (!entry) {
      entry = createObjectMarker(spec, pose);
      entry.marker.addTo(map);
      registry.set(spec.id, entry);
    }
    updateObjectMarker(entry, spec, pose);
  }

  for (const [id, entry] of registry) {
    if (!seen.has(id)) {
      entry.marker.removeFrom(map);
      registry.delete(id);
    }
  }
}

export function renderShapes(
  map: L.Map,
  store: SceneStore,
  registry: Map<string, L.Layer>,
): void {
  const seen = new Set<string>();

  for (const shape of store.snapshot().shapes) {
    seen.add(shape.id);
    const existing = registry.get(shape.id);
    const next = renderShape(shape, existing);
    if (next !== existing) {
      existing?.removeFrom(map);
      next.addTo(map);
      registry.set(shape.id, next);
    }
  }

  for (const [id, layer] of registry) {
    if (!seen.has(id)) {
      layer.removeFrom(map);
      registry.delete(id);
    }
  }
}

export function renderTracks(
  map: L.Map,
  store: SceneStore,
  registry: Map<string, L.Polyline>,
): void {
  const seen = new Set<string>();

  for (const track of store.tracksList()) {
    const points = track.getPoints();
    if (points.length < 2) continue;
    seen.add(track.id);
    const latlngs = points.map((point) => [point.lat, point.lon] as [number, number]);

    let line = registry.get(track.id);
    if (!line) {
      line = L.polyline(latlngs, {
        color: normalizeColor(track.style?.color ?? "#6a0090"),
        weight: track.style?.widthPx ?? 4,
        opacity: track.style?.opacity ?? 0.95,
        dashArray: track.style?.dashed
          ? `${track.style.dashPx ?? 6} ${track.style.gapPx ?? 5}`
          : undefined,
        interactive: false,
      });
      line.addTo(map);
      registry.set(track.id, line);
    } else {
      line.setLatLngs(latlngs);
    }
  }

  for (const [id, line] of registry) {
    if (!seen.has(id)) {
      line.removeFrom(map);
      registry.delete(id);
    }
  }
}
