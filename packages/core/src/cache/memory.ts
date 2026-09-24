// src/cache/memory.ts — in-process LRU cache (also the L1 in front of disk).
import type { CacheAdapter, CacheKey, CacheStats } from "./types";

export type MemoryCacheOptions = {
  /** Soft limit in bytes (default 64 MB). */
  maxBytes?: number;
  /** Soft limit in entries (default 4096). */
  maxEntries?: number;
};

type Entry = { data: ArrayBuffer; bytes: number };

export function createMemoryCache(options: MemoryCacheOptions = {}): CacheAdapter {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 4096;
  const entries = new Map<CacheKey, Entry>();
  let bytes = 0;

  const touch = (key: CacheKey, entry: Entry) => {
    /* Map keeps insertion order: re-insert to mark as most recently used */
    entries.delete(key);
    entries.set(key, entry);
  };

  const evict = () => {
    while ((bytes > maxBytes || entries.size > maxEntries) && entries.size > 0) {
      const oldest = entries.keys().next().value as CacheKey | undefined;
      if (oldest === undefined) break;
      const entry = entries.get(oldest);
      entries.delete(oldest);
      bytes -= entry?.bytes ?? 0;
    }
  };

  const removeKey = (key: CacheKey) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    bytes -= entry.bytes;
  };

  return {
    name: `memory(${Math.round(maxBytes / 1024 / 1024)}MB)`,

    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      touch(key, entry);
      return entry.data.slice(0);
    },

    async has(key) {
      return entries.has(key);
    },

    async put(key, data) {
      const existing = entries.get(key);
      if (existing) bytes -= existing.bytes;
      const entry: Entry = { data: data.slice(0), bytes: data.byteLength };
      entries.set(key, entry);
      bytes += entry.bytes;
      evict();
    },

    async delete(key) {
      removeKey(key);
    },

    async clear(prefix) {
      if (!prefix) {
        entries.clear();
        bytes = 0;
        return;
      }
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) removeKey(key);
      }
    },

    async stats(): Promise<CacheStats> {
      return { adapter: "memory", entries: entries.size, bytes };
    },

    async keys(prefix) {
      const all = [...entries.keys()];
      return prefix ? all.filter((key) => key.startsWith(prefix)) : all;
    },
  };
}
