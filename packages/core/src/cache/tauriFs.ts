// src/cache/tauriFs.ts — the disk cache for Tauri apps.
//
// The fs plugin is imported dynamically, so this module is safe to include in a
// pure browser bundle (the adapter simply reports itself as unavailable).
import { parseTileKey } from "./paths";
import type { CacheAdapter, CacheKey, CacheStats } from "./types";

export type TauriFsCacheOptions = {
  /** Directory holding the cache, relative to `baseDir` (or absolute). */
  rootDir?: string;
  /** Tauri BaseDirectory (default: `Document`). */
  baseDir?: unknown;
  /** Create directories as needed (default true). */
  createRoot?: boolean;
};

type FsApi = {
  exists(path: string, opts?: unknown): Promise<boolean>;
  readFile(path: string, opts?: unknown): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, opts?: unknown): Promise<void>;
  mkdir(path: string, opts?: unknown): Promise<void>;
  remove(path: string, opts?: unknown): Promise<void>;
  stat(path: string, opts?: unknown): Promise<{ size: number }>;
  readDir(path: string, opts?: unknown): Promise<{ name: string; isDirectory: boolean }[]>;
  BaseDirectory: unknown;
};

async function loadFs(): Promise<FsApi | null> {
  if (typeof window === "undefined") return null;
  try {
    /* computed specifier: TypeScript never tries to resolve the optional dep */
    const specifier = "@tauri-apps/plugin-fs";
    return (await import(/* @vite-ignore */ specifier)) as unknown as FsApi;
  } catch {
    return null;
  }
}

let fsPromise: Promise<FsApi | null> | null = null;
const fs = () => (fsPromise ??= loadFs());

/** True when running inside a Tauri app where the fs plugin is available. */
export async function isTauriFsAvailable(): Promise<boolean> {
  const api = await fs();
  return !!(api && typeof (globalThis as any).__TAURI_INTERNALS__ !== "undefined");
}

export function createTauriFsCache(options: TauriFsCacheOptions = {}): CacheAdapter {
  const rootDir = (options.rootDir ?? "RadiumEngine/tiles").replace(/\\/g, "/");
  let rootReady = false;
  let BaseDirectory: unknown = options.baseDir;

  const pathOf = (key: CacheKey) => `${rootDir}/${key}`;

  const ensureRoot = async (api: FsApi) => {
    if (rootReady || options.createRoot === false) return;
    BaseDirectory ??= api.BaseDirectory;
    const segments = rootDir.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      try {
        await api.mkdir(current, { baseDir: BaseDirectory, recursive: true });
      } catch {
        /* already there */
      }
    }
    rootReady = true;
  };

  const walk = async (api: FsApi, prefix: CacheKey): Promise<CacheKey[]> => {
    const keys: CacheKey[] = [];
    const visit = async (dir: string) => {
      const entries = await api.readDir(`${rootDir}/${dir}`.replace(/\/$/, ""), {
        baseDir: BaseDirectory,
      });
      for (const entry of entries) {
        const next = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory) await visit(next);
        else keys.push(next);
      }
    };
    try {
      await visit(prefix);
    } catch {
      /* missing folder means empty cache */
    }
    return keys;
  };

  return {
    name: `tauri-fs(${rootDir})`,

    async get(key) {
      const api = await fs();
      if (!api) return null;
      BaseDirectory ??= api.BaseDirectory;
      try {
        const bytes = await api.readFile(pathOf(key), { baseDir: BaseDirectory });
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },

    async has(key) {
      const api = await fs();
      if (!api) return false;
      BaseDirectory ??= api.BaseDirectory;
      try {
        return await api.exists(pathOf(key), { baseDir: BaseDirectory });
      } catch {
        return false;
      }
    },

    async put(key, data) {
      const api = await fs();
      if (!api) return;
      BaseDirectory ??= api.BaseDirectory;
      await ensureRoot(api);
      const { folder, z, x } = parseTileKey(key) ?? { folder: "", z: 0, x: 0 };
      await api.mkdir(`${rootDir}/${folder}/${z}/${x}`, {
        baseDir: BaseDirectory,
        recursive: true,
      });
      await api.writeFile(pathOf(key), new Uint8Array(data), { baseDir: BaseDirectory });
    },

    async delete(key) {
      const api = await fs();
      if (!api) return;
      BaseDirectory ??= api.BaseDirectory;
      try {
        await api.remove(pathOf(key), { baseDir: BaseDirectory });
      } catch {
        /* already gone */
      }
    },

    async clear(prefix) {
      const api = await fs();
      if (!api) return;
      BaseDirectory ??= api.BaseDirectory;
      const keys = await walk(api, prefix ?? "");
      for (const key of keys) {
        if (!prefix || key.startsWith(prefix)) await this.delete(key);
      }
    },

    async stats(): Promise<CacheStats> {
      const api = await fs();
      if (!api) return { adapter: "tauri-fs", entries: 0, bytes: 0, location: rootDir };
      BaseDirectory ??= api.BaseDirectory;
      const keys = await walk(api, "");
      let bytes = 0;
      for (const key of keys) {
        try {
          const info = await api.stat(pathOf(key), { baseDir: BaseDirectory });
          bytes += info.size ?? 0;
        } catch {
          /* ignore */
        }
      }
      return { adapter: "tauri-fs", entries: keys.length, bytes, location: rootDir };
    },

    async keys(prefix) {
      const api = await fs();
      if (!api) return [];
      BaseDirectory ??= api.BaseDirectory;
      return walk(api, prefix ?? "");
    },
  };
}
