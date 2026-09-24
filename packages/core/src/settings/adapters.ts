// src/settings/adapters.ts — where a settings document is kept.
//
// One interface, three implementations, chosen by `createSettingsAdapter`:
//   memory         tests and SSR (nothing survives the process — on purpose)
//   localStorage   a plain web/Electron app, no permissions needed
//   tauri fs       a Tauri app: a real file in the app's data directory
//
// `@tauri-apps/plugin-fs` is imported *lazily* (and only when the runtime says it is
// there), so core keeps its zero-dependency rule and a web build never bundles it.
import type { SettingsAdapter } from "./types";

export function createMemoryAdapter(initial: unknown = null): SettingsAdapter {
  let value: unknown = initial;
  return {
    id: "memory",
    async load() {
      return value;
    },
    async save(data) {
      value = data;
    },
    async clear() {
      value = null;
    },
  };
}

/** `window.localStorage`, keyed. A file-like JSON document, not one key per field. */
export function createLocalStorageAdapter(key: string): SettingsAdapter {
  const storage = () => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null; // blocked (private mode, sandboxed iframe) — degrade silently
    }
  };

  return {
    id: "localStorage",
    async load() {
      const raw = storage()?.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null; // a corrupt document must not break startup
      }
    },
    async save(data) {
      try {
        storage()?.setItem(key, JSON.stringify(data));
      } catch {
        /* quota / blocked: the in-memory state is still correct */
      }
    },
    async clear() {
      try {
        storage()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export type TauriAdapterOptions = {
  /** file name inside the app data directory, e.g. "myapp-settings.json" */
  file: string;
  /** where to put it: "appData" (default), "document" or "resource" */
  base?: "appData" | "document" | "resource";
};

/**
 * A real file, through the Tauri fs plugin. Everything is lazily imported and every
 * failure (missing plugin, missing permission, read-only disk) downgrades to
 * "no stored settings" instead of throwing: a settings file is never a reason for an
 * app not to start.
 */
export function createTauriSettingsAdapter(options: TauriAdapterOptions): SettingsAdapter {
  const base = options.base ?? "appData";

  /* Computed specifiers: the Tauri packages are OPTIONAL peers, so nothing may resolve
     them at build time (a static specifier makes the consumer's bundler fail on an app
     that does not use Tauri at all). Same trick as `cache/tauriFs.ts`. */
  const fsSpecifier = "@tauri-apps/plugin-fs";
  const pathSpecifier = "@tauri-apps/api/path";

  const mods = async () => {
    const [fs, path] = await Promise.all([
      import(/* @vite-ignore */ fsSpecifier),
      import(/* @vite-ignore */ pathSpecifier),
    ]);
    return { fs: fs as any, path: path as any };
  };

  const locate = async () => {
    const { fs, path } = await mods();
    const directory =
      base === "document"
        ? await path.documentDir()
        : base === "resource"
          ? await path.resolveResource("")
          : await path.appDataDir();
    const join = path.join ?? ((...parts: string[]) => parts.filter(Boolean).join("/"));
    return { fs, directory: String(directory).replace(/[\\/]$/, ""), join };
  };

  return {
    id: `tauri-fs(${base})`,
    async load() {
      try {
        const { fs, directory, join } = await locate();
        const file = await join(directory, options.file);
        if (!(await fs.exists(file))) return null;
        return JSON.parse(await fs.readTextFile(file));
      } catch {
        return null;
      }
    },
    async save(data) {
      try {
        const { fs, directory, join } = await locate();
        const file = await join(directory, options.file);
        if (fs.mkdir) await fs.mkdir(directory, { recursive: true }).catch(() => undefined);
        await fs.writeTextFile(file, JSON.stringify(data, null, 2));
      } catch (error) {
        console.warn("[RadiumEngine] settings could not be saved", error);
      }
    },
    async clear() {
      try {
        const { fs, directory, join } = await locate();
        const file = await join(directory, options.file);
        if (await fs.exists(file)) await fs.remove(file);
      } catch {
        /* ignore */
      }
    },
  };
}
