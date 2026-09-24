// src/cache/none.ts + cache/index.ts
import { createIndexedDbCache } from "./indexeddb";
import { createMemoryCache } from "./memory";
import { createTauriFsCache, isTauriFsAvailable } from "./tauriFs";
import type { CacheAdapter, CacheStats } from "./types";

/** A cache that stores nothing (always a miss, "online only" mode). */
export function createNullCache(): CacheAdapter {
  return {
    name: "none",
    async get() {
      return null;
    },
    async has() {
      return false;
    },
    async put() {
      /* nothing */
    },
    async delete() {
      /* nothing */
    },
    async clear() {
      /* nothing */
    },
    async stats(): Promise<CacheStats> {
      return { adapter: "none", entries: 0, bytes: 0 };
    },
    async keys() {
      return [];
    },
  };
}

export type CacheKind = "auto" | "tauri-fs" | "indexeddb" | "memory" | "none";

export type CacheConfig = {
  /** Which adapter to use. "auto" = tauri-fs inside Tauri, else indexeddb. */
  kind?: CacheKind;
  /** Disk location (Tauri only): folder holding the tile tree. */
  rootDir?: string;
  /** Tauri BaseDirectory to resolve `rootDir` against. */
  baseDir?: unknown;
  /** Memory adapter limits. */
  maxBytes?: number;
  maxEntries?: number;
  /** IndexedDB database name. */
  database?: string;
};

/** Wrap any adapter with a small in-memory L1 layer (default for all kinds). */
export function withMemoryL1(adapter: CacheAdapter, options: { maxBytes?: number; maxEntries?: number } = {}): CacheAdapter {
  const l1 = createMemoryCache(options);
  return {
    get name() {
      return `${adapter.name}+l1`;
    },
    get: async (key) => (await l1.get(key)) ?? adapter.get(key),
    has: async (key) => (await l1.has(key)) || adapter.has(key),
    put: async (key, data) => {
      await l1.put(key, data);
      await adapter.put(key, data);
    },
    delete: async (key) => {
      await l1.delete(key);
      await adapter.delete(key);
    },
    clear: async (prefix) => {
      await l1.clear(prefix);
      await adapter.clear(prefix);
    },
    stats: async () => {
      const base = await adapter.stats();
      const top = await l1.stats();
      return {
        ...base,
        adapter: `${base.adapter}+l1`,
        entries: base.entries + top.entries,
        bytes: base.bytes + top.bytes,
      };
    },
    keys: (prefix) => adapter.keys?.(prefix) ?? Promise.resolve([]),
  };
}

/** Build the cache the user asked for (with a memory L1 in front of disk). */
export async function createCache(config: CacheConfig = {}): Promise<CacheAdapter> {
  const kind = config.kind ?? "auto";
  const l1 = { maxBytes: config.maxBytes, maxEntries: config.maxEntries };

  if (kind === "none") return createNullCache();
  if (kind === "memory") return createMemoryCache(l1);

  if (kind === "tauri-fs" || kind === "auto") {
    if (await isTauriFsAvailable()) {
      return withMemoryL1(
        createTauriFsCache({ rootDir: config.rootDir, baseDir: config.baseDir }),
        l1,
      );
    }
    if (kind === "tauri-fs") {
      console.warn("[RadiumEngine] tauri-fs cache requested outside Tauri, using indexeddb");
    }
  }

  return withMemoryL1(createIndexedDbCache({ database: config.database }), l1);
}

export { createIndexedDbCache, createMemoryCache, createTauriFsCache, isTauriFsAvailable };
export * from "./paths";
export * from "./types";
