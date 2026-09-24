// src/useEngineSettings.ts — React binding for a `SettingsStore`.
//
// The store holds the rule that matters (never write before the stored document has
// been read — see `settings/store.ts`); this hook makes it usable in a component tree
// and, importantly, exposes `loaded`, which is what a caller waits for before mounting
// anything that would write a value back (a map!).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SettingsStore,
  createLocalStorageAdapter,
  createMemoryAdapter,
  createTauriSettingsAdapter,
  type SettingsAdapter,
  type SettingsStatus,
  type SettingsStoreOptions,
} from "@radium-engine/core";

export type UseSettingsResult<T extends object> = {
  settings: T;
  /** true once the stored document has been read — wait for it before writing */
  loaded: boolean;
  status: SettingsStatus;
  /** merge a partial patch and persist it (queued: safe to call per keystroke) */
  set: (patch: Parameters<SettingsStore<T>["set"]>[0]) => void;
  /** back to the defaults (and deletes the stored document) */
  reset: () => void;
  /** write now (a "Save" button, or before closing a window) */
  flush: () => void;
  store: SettingsStore<T>;
};

/** Subscribe a component to a settings store (create the store outside the tree). */
export function useSettingsStore<T extends object>(store: SettingsStore<T>): UseSettingsResult<T> {
  const [snapshot, setSnapshot] = useState<T>(store.snapshot);
  const [status, setStatus] = useState<SettingsStatus>(store.status);

  useEffect(() => {
    const unsubscribe = store.subscribe((next) => {
      setSnapshot(next);
      setStatus(store.status);
    });
    /* the load is a promise: a second subscription call after it resolves keeps the
       UI in step with what the file actually contained */
    void store.load().then(() => {
      setSnapshot(store.snapshot);
      setStatus(store.status);
    });
    return unsubscribe;
  }, [store]);

  return {
    settings: snapshot,
    loaded: status.loaded,
    status,
    set: store.set.bind(store),
    reset: () => void store.clear(),
    flush: () => void store.flush(),
    store,
  };
}

export type SettingsStoreHookOptions<T extends object> = Omit<SettingsStoreOptions<T>, "adapter"> & {
  /**
   * Where to keep the document. Defaults to `auto`:
   * Tauri file when the app runs inside Tauri, `localStorage` in a browser, memory
   * when neither exists (SSR, tests).
   */
  storage?: "auto" | "localStorage" | "memory" | SettingsAdapter;
  /** file name (Tauri) / storage key (browser) — default "radium-engine.json" */
  key?: string;
};

/** Create the store once, and keep it alive across renders. */
export function useSettingsStoreFactory<T extends object>(
  options: SettingsStoreHookOptions<T>,
): SettingsStore<T> {
  const ref = useRef<{ store: SettingsStore<T>; key: string } | null>(null);
  const key = `${options.storage ?? "auto"}:${options.key ?? "radium-engine.json"}`;
  if (!ref.current || ref.current.key !== key) {
    ref.current = {
      store: new SettingsStore<T>({ ...options, adapter: resolveAdapter(options) }),
      key,
    };
  }
  return ref.current.store;
}

/**
 * One-call convenience: create + subscribe. Equivalent to
 * `useSettingsStore(useSettingsStoreFactory(options))`, kept separate so advanced
 * callers can share one store between several components (which is the point of a
 * store).
 */
export function useSettings<T extends object>(
  options: SettingsStoreHookOptions<T>,
): UseSettingsResult<T> {
  const store = useSettingsStoreFactory(options);
  return useSettingsStore(store);
}

/** The adapter a settings store should use, by environment. */
export function resolveAdapter<T extends object>(options: SettingsStoreHookOptions<T>): SettingsAdapter {
  if (options.storage && typeof options.storage === "object") return options.storage;
  const key = options.key ?? "radium-engine.json";
  const kind = options.storage ?? "auto";
  if (kind === "memory") return createMemoryAdapter();
  if (kind === "localStorage") return createLocalStorageAdapter(key);
  if (typeof window === "undefined") return createMemoryAdapter();
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return tauri ? createTauriSettingsAdapter({ file: key }) : createLocalStorageAdapter(key);
}

/** A one-line human summary of a settings status: handy for a status strip. */
export function useSettingsStatus(status: SettingsStatus) {
  return useMemo(
    () =>
      `settings: ${status.adapter}${status.loaded ? "" : " · loading"}${
        status.dirty ? " · saving" : ""
      }${status.unknownKeys.length ? ` · ${status.unknownKeys.length} unknown key(s)` : ""}`,
    [status],
  );
}
