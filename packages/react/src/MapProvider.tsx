// src/MapProvider.tsx — owns the expensive shared pieces (cache, tile pipeline,
// elevation service, scene store, camera) and hands them to the engines.
import {
  ElevationService,
  SceneStore,
  TilePipeline,
  createCache,
  defaultTileTransforms,
  imageryProviderFor,
  terrainSourceFor,
  type ImageryProvider,
  type TerrainOptions,
} from "@radium-engine/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InteractionProvider } from "./interaction";
import {
  EngineContext,
  type CameraOptions,
  type EngineHandlers,
  type MapApi,
  type MapEngineContextValue,
  type MapEngineOptions,
} from "./context";

export type MapProviderProps = {
  options?: MapEngineOptions;
  children: ReactNode;
};

export function MapProvider({ options = {}, children }: MapProviderProps) {
  const [mode, setModeState] = useState(options.mode ?? "3d");
  const [camera, setCameraState] = useState<CameraOptions>(
    options.camera ?? { lat: 30.0444, lon: 31.2357, zoom: 12, pitch: options.defaultPitch ?? 60 },
  );
  const [pipeline, setPipeline] = useState<TilePipeline | null>(null);
  const [elevation, setElevation] = useState<ElevationService | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const storeRef = useRef<SceneStore | null>(null);
  if (!storeRef.current) storeRef.current = new SceneStore();
  const store = storeRef.current;

  /* ── imagery + terrain descriptors (pure, cheap) ─────────────────── */
  const imagery = useMemo<ImageryProvider>(() => {
    const requested = options.imagery;
    if (requested && typeof requested === "object" && requested.url) {
      return { ...imageryProviderFor("custom", requested.url), ...requested } as ImageryProvider;
    }
    return imageryProviderFor(typeof requested === "string" ? requested : undefined);
  }, [options.imagery]);

  const terrainDisabled = options.terrain === false;
  const terrainSource = useMemo(
    () =>
      terrainDisabled
        ? null
        : terrainSourceFor((options.terrain as TerrainOptions | undefined) ?? {}),
    [terrainDisabled, (options.terrain as TerrainOptions | undefined)?.provider, (options.terrain as TerrainOptions | undefined)?.customUrl, (options.terrain as TerrainOptions | undefined)?.smoothing],
  );

  /* ── cache + tile pipeline: created once ─────────────────────────── */
  useEffect(() => {
    if (options.cache?.enabled === false) {
      setPipeline(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cache = await createCache(options.cache ?? {});
        if (cancelled) return;
        setPipeline(
          new TilePipeline({
            cache,
            transforms: defaultTileTransforms,
            onEvent: options.debug
              ? (event) => console.debug("[RadiumEngine] tile", event.type, "key" in event ? event.key : "")
              : undefined,
          }),
        );
      } catch (error) {
        console.warn("[RadiumEngine] cache could not be created", error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.cache?.kind, options.cache?.rootDir, options.cache?.database, options.cache?.enabled, options.debug]);

  /* ── elevation service follows the terrain selection ─────────────── */
  useEffect(() => {
    if (!pipeline || !terrainSource) {
      setElevation(null);
      return;
    }
    setElevation((current) => {
      if (current) {
        current.setSource({ source: terrainSource });
        return current;
      }
      return new ElevationService(pipeline, { source: terrainSource });
    });
  }, [pipeline, terrainSource]);

  /* ── imperative API bridged to whichever engine is mounted ───────── */
  const handlersRef = useRef<Partial<EngineHandlers>>({});
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const api = useMemo<MapApi>(
    () => ({
      mode,
      setMode: (next) => setModeState(next),
      getMode: () => modeRef.current,
      flyTo: (target, flyOptions) => handlersRef.current.flyTo?.(target, flyOptions),
      fitBounds: (bounds, fitOptions) => handlersRef.current.fitBounds?.(bounds, fitOptions),
      getCamera: () => handlersRef.current.getCamera?.() ?? camera,
      pick: (x, y) => handlersRef.current.pick?.(x, y) ?? null,
      getEngineMap: () => handlersRef.current.getEngineMap?.(),
      bind: (handlers) => {
        handlersRef.current = { ...handlersRef.current, ...handlers };
      },
    }),
    [mode, camera],
  );

  const value = useMemo<MapEngineContextValue>(
    () => ({
      options: {
        ...options,
        mode,
        exaggeration: options.exaggeration ?? 1,
        defaultPitch: options.defaultPitch ?? 60,
        shareCamera: options.shareCamera ?? true,
        attribution: options.attribution ?? true,
      },
      store,
      pipeline,
      elevation,
      imagery,
      terrain: terrainSource,
      camera,
      setCamera: (next) => setCameraState((current) => ({ ...current, ...next })),
      mode,
      setMode: (next) => setModeState(next),
      api,
      ready,
      setReady,
      status: async () => {
        if (!pipeline) return { adapter: "none", entries: 0, bytes: 0 };
        const stats = await pipeline.stats();
        return { adapter: stats.adapter, entries: stats.entries, bytes: stats.bytes };
      },
      version,
      bump,
    }),
    [options, store, pipeline, elevation, imagery, terrainSource, camera, mode, api, ready, version, bump],
  );

  return (
    <EngineContext.Provider value={value}>
      {/* inside the engine context, so the item components can register themselves */}
      <InteractionProvider>{children}</InteractionProvider>
    </EngineContext.Provider>
  );
}
