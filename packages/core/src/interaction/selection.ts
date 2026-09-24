// src/interaction/selection.ts — what is selected, and how a click changes it.
//
// Selection lives in core (not in React) on purpose: it is engine agnostic and it must
// survive a 2D <-> 3D flip, a re-render and — for headless users — React not being there at
// all. Nothing here knows what a "map" is.
//
// One rule is worth spelling out, because getting it backwards makes an app feel broken:
// `multi` only says whether selecting SEVERAL things is ALLOWED. Whether THIS click adds to
// the selection is the caller's decision (a ctrl/cmd/shift modifier, or a long press). A plain
// click replaces the selection, always.
import type { HitKind, MapHit } from "./types";

export type SelectionEntry = { id: string; kind: HitKind };

export type SelectionOptions = {
  /** selecting several items at once is allowed (default true) */
  multi?: boolean;
  onChange?: (selection: SelectionEntry[]) => void;
};

export class SelectionStore {
  private items = new Map<string, SelectionEntry>();
  private listeners = new Set<(selection: SelectionEntry[]) => void>();
  private options: SelectionOptions;

  constructor(options: SelectionOptions = {}) {
    this.options = { multi: options.multi ?? true, ...options };
  }

  get entries(): SelectionEntry[] {
    return [...this.items.values()];
  }

  get ids(): string[] {
    return [...this.items.keys()];
  }

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** The entry with this id, whatever kind it is. */
  get(id: string): SelectionEntry | undefined {
    return this.items.get(id);
  }

  /**
   * Select something, or clear with `null`. `additive` (ctrl/cmd/shift) toggles: it adds when
   * the item was not selected and removes it when it was. Everything else replaces.
   */
  select(hit: SelectionEntry | null, options: { additive?: boolean } = {}): SelectionEntry[] {
    if (!hit) return this.clear();
    const additive = (options.additive ?? false) && this.options.multi !== false;
    if (additive) {
      if (this.items.has(hit.id)) this.items.delete(hit.id);
      else this.items.set(hit.id, { ...hit });
      return this.emit();
    }
    this.items.clear();
    this.items.set(hit.id, { ...hit });
    return this.emit();
  }

  /** Select a set of ids at once (a lasso, a "select all of these" button). */
  setMany(entries: SelectionEntry[]): SelectionEntry[] {
    this.items = new Map(entries.map((entry) => [entry.id, { ...entry }]));
    return this.emit();
  }

  /** Drop everything. */
  clear(): SelectionEntry[] {
    if (this.items.size === 0) return this.entries;
    this.items.clear();
    return this.emit();
  }

  subscribe(listener: (selection: SelectionEntry[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.entries);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): SelectionEntry[] {
    const entries = this.entries;
    this.listeners.forEach((listener) => listener(entries));
    this.options.onChange?.(entries);
    return entries;
  }
}

/** A hit, as a selection entry (`null` stays `null`, so `select(entryOf(hit))` is safe). */
export function entryOf(hit: MapHit | null): SelectionEntry | null {
  return hit ? { id: hit.id, kind: hit.kind } : null;
}