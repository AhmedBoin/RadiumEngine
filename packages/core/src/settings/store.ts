// src/settings/store.ts — persisted options, with the load-before-write rule baked in.
//
// This exists because of a bug class that is easy to hit and hard to see: the UI (and
// the map) mount before the stored document has been read, so they start from the
// DEFAULTS. Any write in that window — a map `moveend`, a "last position" update —
// saves the defaults over the user's file, and every setting the app had comes back
// at its default on the next start. Nothing errors, nothing logs.
//
// The store therefore:
//   * exposes `loaded` (and `status().loaded`) so an app can wait before mounting
//     anything that writes;
//   * holds writes made before the load in a pending list and replays them on top of
//     the loaded document, so an early change is not lost either;
//   * deep-merges with the defaults in both directions (loading and patching), so a
//     field the file predates takes its default and a patch only touches its keys;
//   * coalesces writes, so dragging a slider does not write a file per frame.
import { deepMerge, isPlainObject, type DeepPartial } from "./merge";
import type { SettingsAdapter, SettingsStatus, SettingsStoreOptions } from "./types";

type Listener<T> = (settings: T) => void;

export class SettingsStore<T extends object> {
  private readonly defaults: T;
  private readonly adapter: SettingsAdapter;
  private readonly options: SettingsStoreOptions<T>;
  private state: T;
  private listeners = new Set<Listener<T>>();
  private pending: DeepPartial<T>[] = [];
  private loadedFlag = false;
  private saving = false;
  private dirty = false;
  private savedAt: number | null = null;
  private unknownKeys: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<T> | null = null;

  constructor(options: SettingsStoreOptions<T>) {
    this.defaults = options.defaults;
    this.adapter = options.adapter;
    this.options = options;
    this.state = deepMerge(options.defaults, {});
  }

  /** The current settings (always complete: defaults + stored + changes). */
  get snapshot(): T {
    return this.state;
  }

  /** True once the stored document has been read (successfully or not). */
  get loaded(): boolean {
    return this.loadedFlag;
  }

  get status(): SettingsStatus {
    return {
      adapter: this.adapter.id,
      loaded: this.loadedFlag,
      dirty: this.dirty,
      savedAt: this.savedAt,
      unknownKeys: [...this.unknownKeys],
    };
  }

  /** Read the stored document. Safe to call twice (the second call reuses it). */
  load(): Promise<T> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      let stored: DeepPartial<T> | null = null;
      let migrated = false;
      try {
        const raw = await this.adapter.load();
        if (this.options.migrate) {
          stored = this.options.migrate(raw, this.defaults);
          /* a migration rewrote the document: persist it once, so the next start reads
             a current file instead of re-running the migration forever */
          migrated = !!stored && JSON.stringify(stored) !== JSON.stringify(raw);
        } else {
          stored = raw as DeepPartial<T> | null;
        }
      } catch (error) {
        this.fail(error);
      }

      this.unknownKeys =
        this.options.strict && isPlainObject(stored)
          ? Object.keys(stored).filter((key) => !(key in this.defaults))
          : [];

      let merged = deepMerge(this.defaults, stored ?? undefined);
      /* Anything the app changed while the file was being read is newer than the file:
         those changes were made against a complete (default) tree, so they are merged
         on top instead of being overwritten by the stored values. */
      for (const patch of this.pending) merged = deepMerge(merged, patch);
      const replayed = this.pending.length;
      this.pending = [];

      this.state = merged;
      this.loadedFlag = true;
      this.emit();

      /* Write once after loading when the app changed something in the meantime, or when a
         migration rewrote the document: it normalises the file (fills in fields it
         predates) and persists the replayed changes. */
      if (replayed > 0 || migrated) await this.flush();

      return this.state;
    })();
    return this.loadPromise;
  }

  /**
   * Merge a patch and persist it. Before `load()` resolves the change is kept and
   * replayed, never written — writing now would store the defaults.
   */
  set(patch: DeepPartial<T>): T {
    this.state = deepMerge(this.state, patch);
    this.emit();

    if (!this.loadedFlag) {
      this.pending.push(patch);
      return this.state;
    }
    this.queueSave();
    return this.state;
  }

  /** Replace a branch wholesale (used by "reset this section" buttons). */
  reset(): T {
    this.state = deepMerge(this.defaults, {});
    this.emit();
    if (this.loadedFlag) this.queueSave();
    else this.pending.push({});
    return this.state;
  }

  /** Write now (used by a "Save" button, or before closing a window). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) return;
    this.saving = true;
    this.dirty = true;
    try {
      await this.adapter.save(this.state);
      this.savedAt = Date.now();
      this.dirty = false;
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  /** Delete the stored document and go back to the defaults. */
  async clear(): Promise<T> {
    try {
      await this.adapter.clear?.();
    } catch (error) {
      this.fail(error);
    }
    return this.reset();
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private queueSave(): void {
    const delay = this.options.debounceMs ?? 250;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private fail(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.warn("[RadiumEngine] settings problem", error);
  }
}
