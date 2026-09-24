// src/cache/types.ts — the cache contract every adapter implements.
//
// A cache stores raw tile bytes keyed by "<folder>/<z>/<x>/<y>" so imagery and
// terrain tiles share one namespace while staying in separate folders. Nothing
// in RadiumEngine ever hits the network twice for the same key.

export type CacheKey = string;

export type CacheStats = {
  adapter: string;
  entries: number;
  bytes: number;
  /** Where the data lives, for "open folder" style UIs. */
  location?: string;
};

export type CacheAdapter = {
  readonly name: string;
  get(key: CacheKey): Promise<ArrayBuffer | null>;
  has(key: CacheKey): Promise<boolean>;
  put(key: CacheKey, data: ArrayBuffer): Promise<void>;
  delete(key: CacheKey): Promise<void>;
  /** Remove everything, or only keys starting with `prefix`. */
  clear(prefix?: string): Promise<void>;
  stats(): Promise<CacheStats>;
  /** Optional: enumerate keys (used by the cache inspector UI). */
  keys?(prefix?: string): Promise<CacheKey[]>;
};

export type CacheEvent =
  | { type: "hit"; key: CacheKey }
  | { type: "miss"; key: CacheKey }
  | { type: "store"; key: CacheKey; bytes: number }
  | { type: "error"; key: CacheKey; error: unknown };
