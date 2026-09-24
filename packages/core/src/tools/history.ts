// src/tools/history.ts — undo/redo for any state, in ~100 lines.
//
// Every editor needs it and every editor implements it twice (once for the scene, once for
// the settings). This is the generic version: push a SNAPSHOT of whatever your editor holds,
// get `undo()`/`redo()` back. Snapshots rather than diffs on purpose — an editor whose state
// is a plain object (which is the whole design of this engine) does not need inverse deltas,
// and a snapshot cannot produce the "undo applied to the wrong version" bug.
//
// Coalescing is what makes it usable from a slider: pushing the same label within
// `coalesceMs` REPLACES the newest entry instead of adding one, so dragging an altitude
// handle is one undo step, not two hundred.
import type { DeepPartial } from "../settings/merge";

export type HistoryEntry<T> = { state: T; label: string; at: number };

export type HistoryOptions<T> = {
  /** how many steps to keep (default 100) */
  limit?: number;
  /** the state before the first push (becomes the first undo target) */
  initial?: T;
  /** same-label pushes within this window replace each other (default 400 ms) */
  coalesceMs?: number;
  onChange?: (state: T | undefined, meta: { canUndo: boolean; canRedo: boolean }) => void;
};

export class HistoryStore<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: HistoryEntry<T> | undefined;
  private listeners = new Set<(state: T | undefined) => void>();
  private options: Required<Pick<HistoryOptions<T>, "limit" | "coalesceMs">> & HistoryOptions<T>;

  constructor(options: HistoryOptions<T> = {}) {
    this.options = { limit: options.limit ?? 100, coalesceMs: options.coalesceMs ?? 400, ...options };
    if (options.initial !== undefined) {
      this.current = { state: options.initial, label: "initial", at: Date.now() };
    }
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** The state right now (undefined until something was pushed). */
  get present(): T | undefined {
    return this.current?.state;
  }

  get label(): string {
    return this.current?.label ?? "";
  }

  /** The labels of what an undo would step through, newest first (for a menu). */
  get undoStack(): string[] {
    return [...this.past].reverse().map((entry) => entry.label);
  }

  get redoStack(): string[] {
    return this.future.map((entry) => entry.label);
  }

  /**
   * Record a new state. The previous one becomes the next undo target; the redo stack is
   * cleared (a new edit invalidates the branch you had gone back from).
   */
  push(state: T, label = "edit", now = Date.now()): T {
    const coalesce = this.current && this.options.coalesceMs > 0 && now - this.current.at < this.options.coalesceMs;
    if (coalesce && this.current!.label === label) {
      /* same intent, still in the same gesture: replace, do not stack */
      this.current = { state, label, at: now };
      this.future = [];
      this.commit();
      return state;
    }
    if (this.current) {
      this.past.push(this.current);
      if (this.past.length > this.options.limit) this.past.splice(0, this.past.length - this.options.limit);
    }
    this.current = { state, label, at: now };
    this.future = [];
    this.commit();
    return state;
  }

  undo(): T | undefined {
    const previous = this.past.pop();
    if (!previous) return this.present;
    if (this.current) this.future.unshift(this.current);
    this.current = previous;
    return this.commit();
  }

  redo(): T | undefined {
    const next = this.future.shift();
    if (!next) return this.present;
    if (this.current) this.past.push(this.current);
    this.current = next;
    return this.commit();
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.current = undefined;
    this.commit();
  }

  subscribe(listener: (state: T | undefined) => void): () => void {
    this.listeners.add(listener);
    listener(this.present);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(): T | undefined {
    const state = this.present;
    this.listeners.forEach((listener) => listener(state));
    this.options.onChange?.(state, { canUndo: this.canUndo, canRedo: this.canRedo });
    return state;
  }
}

/** `DeepPartial` is re-exported so an editor can type its patches without importing twice. */
export type { DeepPartial };