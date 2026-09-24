// src/cache/indexeddb.ts — the browser (non Tauri) disk-ish cache.
import type { CacheAdapter, CacheKey, CacheStats } from "./types";

export type IndexedDbCacheOptions = {
  database?: string;
  store?: string;
};

/** Simple key/value cache in IndexedDB: survives reloads in a plain web app. */
export function createIndexedDbCache(options: IndexedDbCacheOptions = {}): CacheAdapter {
  const database = options.database ?? "radium-engine";
  const store = options.store ?? "tiles";
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> => {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    });
  };

  return {
    name: `indexeddb(${database}/${store})`,

    async get(key) {
      const value = await withStore<ArrayBuffer | Uint8Array>("readonly", (s) => s.get(key));
      if (!value) return null;
      return value instanceof ArrayBuffer
        ? value
        : (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
    },

    async has(key) {
      const value = await withStore<ArrayBuffer>("readonly", (s) => s.get(key));
      return !!value;
    },

    async put(key, data) {
      await withStore("readwrite", (s) => s.put(new Uint8Array(data), key));
    },

    async delete(key) {
      await withStore("readwrite", (s) => s.delete(key));
    },

    async clear(prefix) {
      const cache = this;
      const keys = (await cache.keys?.(prefix)) ?? [];
      for (const key of keys) await cache.delete(key);
    },

    async stats(): Promise<CacheStats> {
      const cache = this;
      const keys = (await cache.keys?.()) ?? [];
      let bytes = 0;
      for (const key of keys) {
        const value = await withStore<ArrayBuffer>("readonly", (s) => s.get(key));
        bytes += value ? (value as ArrayBuffer).byteLength ?? 0 : 0;
      }
      return { adapter: "indexeddb", entries: keys.length, bytes, location: database };
    },

    async keys(prefix) {
      const keys = (await withStore<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) ?? [];
      const list = keys.map(String) as CacheKey[];
      return prefix ? list.filter((key) => key.startsWith(prefix)) : list;
    },
  };
}
