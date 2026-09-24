// src/scene/store.ts — the engine agnostic scene state.
//
// Both engines (Leaflet 2D, MapLibre + three.js 3D) render exactly this store,
// which is how the same declarative tree appears identically in both and why
// flipping between them keeps everything in place.
import { PoseStore } from "../motion/poseStore";
import { TrackRecorder } from "../tracks/recorder";
import type {
  FillStyle,
  LatLng,
  LatLngAlt,
  MapObjectSpec,
  ModelSpec,
  MotionOptions,
  Pose6,
  StrokeStyle,
  TrackOptions,
} from "../types";

export type ShapeSpec =
  | { kind: "polyline"; id: string; points: LatLngAlt[]; style?: StrokeStyle; data?: unknown }
  | {
      kind: "polygon";
      id: string;
      points: LatLng[];
      style?: StrokeStyle & FillStyle;
      data?: unknown;
    }
  | {
      kind: "circle";
      id: string;
      center: LatLng;
      radiusM: number;
      style?: StrokeStyle & FillStyle;
      data?: unknown;
    }
  | { kind: "dropLine"; id: string; pose: Pose6; style?: StrokeStyle; data?: unknown }
  | {
      kind: "label";
      id: string;
      pose: LatLngAlt;
      text: string;
      style?: { color?: string; fontSizePx?: number; background?: string };
      data?: unknown;
    }
  | {
      kind: "marker";
      id: string;
      pose: LatLngAlt;
      model: ModelSpec;
      rotationDeg?: number;
      style?: { zIndex?: number; interactive?: boolean };
      data?: unknown;
    };

export type SceneSnapshot = {
  objects: MapObjectSpec[];
  shapes: ShapeSpec[];
};

type Listener = (snapshot: SceneSnapshot) => void;

/**
 * Holds objects, their motion interpolators and their tracks, plus the drawing
 * primitives. Engines subscribe; nothing else touches the engine APIs directly.
 */
export class SceneStore {
  private objects = new Map<string, MapObjectSpec>();
  private shapes = new Map<string, ShapeSpec>();
  private poses = new PoseStore();
  private tracks = new Map<string, TrackRecorder>();
  private listeners = new Set<Listener>();

  /* ── objects ─────────────────────────────────────────────────────── */

  upsert(spec: MapObjectSpec): void {
    this.objects.set(spec.id, spec);
    this.poses.ensure(spec.id, spec.motion);
    this.poses.get(spec.id)!.push(spec.pose6);

    if (spec.track) {
      const track = this.ensureTrack(spec.id, spec.track);
      track.push({ lat: spec.pose6.lat, lon: spec.pose6.lon, alt: spec.pose6.alt });
    }

    this.notify();
  }

  /** Move an object without touching its model/track settings (the hot path). */
  setPose(id: string, pose: Pose6, motion?: MotionOptions): void {
    const existing = this.objects.get(id);
    const spec: MapObjectSpec = existing
      ? { ...existing, pose6: pose, motion: motion ?? existing.motion }
      : { id, pose6: pose, motion };
    this.upsert(spec);
  }

  remove(id: string): void {
    const removed = this.objects.delete(id);
    this.poses.remove(id);
    this.tracks.delete(id);
    if (removed) this.notify();
  }

  get(id: string): MapObjectSpec | undefined {
    return this.objects.get(id);
  }

  /** The pose to draw right now (interpolated according to the motion mode). */
  displayPose(id: string): Pose6 | null {
    const interpolator = this.poses.get(id);
    return interpolator ? interpolator.sample() : this.objects.get(id)?.pose6 ?? null;
  }

  get poseStore(): PoseStore {
    return this.poses;
  }

  get active(): boolean {
    return this.poses.active;
  }

  /* ── tracks ──────────────────────────────────────────────────────── */

  ensureTrack(id: string, options: Omit<TrackOptions, "id"> = {}): TrackRecorder {
    let track = this.tracks.get(id);
    if (!track) {
      track = new TrackRecorder({ id, ...options });
      this.tracks.set(id, track);
    } else {
      track.setOptions(options);
    }
    return track;
  }

  getTrack(id: string): TrackRecorder | undefined {
    return this.tracks.get(id);
  }

  tracksList(): TrackRecorder[] {
    return [...this.tracks.values()];
  }

  clearTracks(): void {
    for (const track of this.tracks.values()) track.clear();
    this.notify();
  }

  /* ── drawing primitives ──────────────────────────────────────────── */

  setShape(shape: ShapeSpec): void {
    this.shapes.set(shape.id, shape);
    this.notify();
  }

  setShapes(shapes: ShapeSpec[]): void {
    this.shapes.clear();
    for (const shape of shapes) this.shapes.set(shape.id, shape);
    this.notify();
  }

  removeShape(id: string): void {
    if (this.shapes.delete(id)) this.notify();
  }

  clearShapes(): void {
    if (this.shapes.size === 0) return;
    this.shapes.clear();
    this.notify();
  }

  /* ── subscriptions ───────────────────────────────────────────────── */

  snapshot(): SceneSnapshot {
    return { objects: [...this.objects.values()], shapes: [...this.shapes.values()] };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
