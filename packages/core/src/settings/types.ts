// src/settings/types.ts — what a settings store needs from its storage.
import type { DeepPartial } from "./merge";

export type SettingsAdapter = {
  /** reported in `store.status()` so an app can show where settings live */
  id: string;
  load: () => Promise<unknown | null>;
  save: (data: unknown) => Promise<void>;
  clear?: () => Promise<void>;
};

export type SettingsStoreOptions<T extends object> = {
  /** every field, with the value it has on a first run */
  defaults: T;
  adapter: SettingsAdapter;
  /**
   * Bring an old document up to date (renamed field, changed unit…). Runs on the
   * loaded document *before* it is merged with the defaults, and its result is what
   * gets written back — the only place a migration may touch.
   */
  migrate?: (stored: unknown, defaults: T) => DeepPartial<T> | null;
  /** Warn on unknown keys (a typo in a settings UI is otherwise invisible). */
  strict?: boolean;
  /** Coalesce writes: a slider drag must not write 60 files a second. */
  debounceMs?: number;
  /** Called on every save failure (a full disk, a missing permission). */
  onError?: (error: unknown) => void;
};

export type SettingsStatus = {
  /** where the document lives (adapter id) */
  adapter: string;
  /** true once the stored document has been read (or read-and-failed) */
  loaded: boolean;
  /** true while a save is still pending */
  dirty: boolean;
  /** when the current state was last written successfully */
  savedAt: number | null;
  /** keys in the document that the defaults do not know */
  unknownKeys: string[];
};
