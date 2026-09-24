import type { MotionOptions } from "../types";
import { PoseInterpolator } from "./interpolation";

/**
 * One interpolator per object id. Engines subscribe once and read every frame —
 * that is what keeps 2D and 3D in lock step and identical to each other.
 */
export class PoseStore {
  private items = new Map<string, PoseInterpolator>();
  private listeners = new Set<() => void>();
  private frame: number | null = null;

  ensure(id: string, options?: MotionOptions): PoseInterpolator {
    let interpolator = this.items.get(id);
    if (!interpolator) {
      interpolator = new PoseInterpolator(options);
      this.items.set(id, interpolator);
    } else if (options) {
      interpolator.configure(options);
    }
    return interpolator;
  }

  get(id: string): PoseInterpolator | undefined {
    return this.items.get(id);
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  /** True while at least one object is still animating. */
  get active(): boolean {
    for (const interpolator of this.items.values()) {
      if (interpolator.active) return true;
    }
    return false;
  }

  /** Notified on every animation frame while something is moving. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.schedule();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private schedule(): void {
    if (this.frame !== null || typeof requestAnimationFrame !== "function") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.listeners.forEach((listener) => listener());
      if (this.active) this.schedule();
    });
  }
}
