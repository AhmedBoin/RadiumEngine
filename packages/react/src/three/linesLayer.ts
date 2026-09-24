// src/three/linesLayer.ts — all 3D line work in ONE custom layer.
//
// mission paths, tracks, circle outlines, fence outlines and vertical drop lines
// are all fat lines (screen-space width). The layer re-samples its geometry only
// when the data or the zoom really changed, so drawing stays cheap.
import type { TilePipeline } from "@radium-engine/core";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";
import { applyLineWidth, createFatLine, createSegmentLines, disposeFatLine, updateFatLine, updateSegmentLines, type FatLine, type SegmentLines } from "./fatLines";
import type { LinePoint } from "./lineGeometry";
import { applyRecenteredProjection, originAtMapCenter, REORIGIN_DRIFT_PX, originDriftPx, unitsPerPixel, type SceneOrigin } from "./sceneOrigin";

export type LineContent = {
  id: string;
  points: LinePoint[];
  color: string | number;
  widthPx: number;
  smooth?: boolean;
  denoise?: boolean;
};

export type DropLinesContent = { segments: [LinePoint, LinePoint][]; color: string | number; widthPx: number };

export type LinesLayerSource = {
  lines: () => LineContent[];
  dropLines: () => DropLinesContent | null;
};

type Visual = { fat: FatLine; signature: string };

export type LinesLayer = CustomLayerInterface & {
  scene: THREE.Scene;
  sync: () => void;
};

export function createLinesLayer(
  map: MapLibreMap,
  source: LinesLayerSource,
  pipeline: TilePipeline | null,
): LinesLayer {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  let renderer: THREE.WebGLRenderer | null = null;
  const visuals = new Map<string, Visual>();
  let drops: SegmentLines | null = null;
  let dropsSignature = "";
  let origin: SceneOrigin = originAtMapCenter(map);

  const layer: LinesLayer = {
    id: "radium-engine-lines",
    type: "custom",
    renderingMode: "3d",
    scene,

    onAdd(target, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: target.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },

    render(_gl, options) {
      if (!renderer) return;
      const matrix = options?.defaultProjectionData?.mainMatrix;
      if (!matrix) return;

      /* keep geometry close to the camera (float32 precision) */
      if (originDriftPx(origin, map) > REORIGIN_DRIFT_PX) {
        origin = originAtMapCenter(map);
        for (const visual of visuals.values()) visual.signature = "";
        dropsSignature = "";
        layer.sync();
      }

      const ratio = (() => {
        const canvas = map.getCanvas();
        const cssWidth = canvas.clientWidth || canvas.width || 1;
        return (canvas.width || cssWidth) / cssWidth;
      })();
      for (const visual of visuals.values()) applyLineWidth(visual.fat, ratio);
      if (drops) applyLineWidth(drops, ratio);

      applyRecenteredProjection(camera.projectionMatrix, matrix, origin);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      for (const visual of visuals.values()) disposeFatLine(visual.fat);
      visuals.clear();
      if (drops) disposeFatLine(drops);
      drops = null;
      renderer?.dispose();
      renderer = null;
    },

    sync() {
      const upp = unitsPerPixel(map.getZoom());
      const wanted = new Set<string>();

      for (const content of source.lines()) {
        if (content.points.length < 2) continue;
        wanted.add(content.id);

        let digest = 0;
        for (const point of content.points) {
          digest = (digest * 31 + point.lat * 1e5 + point.lon * 1e5 + (point.alt || 0)) % 1e12;
        }
        const signature = [content.color, content.points.length, digest.toFixed(6), content.widthPx, content.smooth ? 1 : 0, Math.round(Math.log2(1 / upp))].join("|");

        const existing = visuals.get(content.id);
        if (existing && existing.signature === signature) continue;

        const options = {
          color: content.color,
          widthPx: content.widthPx,
          origin,
          smooth: content.smooth,
          denoise: content.denoise,
          unitsPerPixel: upp,
        };

        if (existing) {
          if (updateFatLine(existing.fat, content.points, options)) existing.signature = signature;
          continue;
        }
        const fat = createFatLine(content.points, options);
        if (!fat) continue;
        scene.add(fat.line);
        visuals.set(content.id, { fat, signature });
      }

      for (const [id, visual] of visuals) {
        if (!wanted.has(id)) {
          disposeFatLine(visual.fat);
          visuals.delete(id);
        }
      }

      /* vertical drop lines (all segments in one object) */
      const dropContent = source.dropLines();
      const dropSignature = dropContent
        ? `${dropContent.segments.length}|${dropContent.color}|${dropContent.widthPx}|${dropContent.segments
            .map(([a]) => `${a.lat.toFixed(6)},${a.lon.toFixed(6)},${a.alt.toFixed(2)}`)
            .join(";")}`
        : "";
      if (dropSignature !== dropsSignature) {
        dropsSignature = dropSignature;
        if (!dropContent || dropContent.segments.length === 0) {
          if (drops) {
            disposeFatLine(drops);
            drops = null;
          }
        } else if (drops) {
          updateSegmentLines(drops, dropContent.segments, origin);
        } else {
          const created = createSegmentLines(dropContent.segments, {
            color: dropContent.color,
            widthPx: dropContent.widthPx,
            origin,
          });
          if (created) {
            scene.add(created.line);
            drops = created;
          }
        }
      }

      void pipeline;
    },
  };

  return layer;
}
