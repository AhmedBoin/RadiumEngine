// src/interaction.tsx — clicks, hovers and selection, wired to both engines.
//
// The engine-agnostic half lives in @radium-engine/core (hit testing in screen space, the
// selection store). This file is the React half: it listens on the map container, projects
// through whichever engine is mounted (Leaflet is own containerPoint API, MapLibre is own
// projection matrix — see `three/screenProjection.ts`), and dispatches to the handlers the
// item components registered.
//
// Two rules make it predictable:
//   * everything you draw is clickable by default (an item registers itself as it renders),
//     and `interactive={false}` opts a layer out — a background of 10 000 shapes is drawn,
//     not aimed at;
//   * hover and cursor position live in a small external store read with
//     `useSyncExternalStore`, so moving the mouse does NOT re-render the map tree.
import {
  SelectionStore,
  entryOf,
  hitCandidates,
  pickAtScreen,
  sameHit,
  type HitCandidate,
  type HitKind,
  type InteractionHandlers,
  type MapHit,
  type PointerEventPayload,
  type PointerInfo,
  type Projector,
  type SelectionEntry,
} from "@radium-engine/core";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useMapEngine } from "./context";
import { screenOf } from "./three/screenProjection";

export type InteractionSnapshot = { hovered: MapHit | null; pointer: PointerInfo | null };

/** Hover + cursor position, readable without re-rendering the map. */
class InteractionState {
  private snapshot: InteractionSnapshot = { hovered: null, pointer: null };
  private listeners = new Set<() => void>();

  getSnapshot = (): InteractionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(next: Partial<InteractionSnapshot>): void {
    const hovered = next.hovered !== undefined ? next.hovered : this.snapshot.hovered;
    const pointer = next.pointer !== undefined ? next.pointer : this.snapshot.pointer;
    if (sameHit(hovered, this.snapshot.hovered) && samePointer(pointer, this.snapshot.pointer)) return;
    this.snapshot = { hovered, pointer };
    this.listeners.forEach((listener) => listener());
  }
}

/** Two cursor positions are the same when they are within a tenth of a pixel. */
function samePointer(a: PointerInfo | null, b: PointerInfo | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.inside === b.inside &&
    Math.abs(a.lat - b.lat) < 1e-9 &&
    Math.abs(a.lon - b.lon) < 1e-9 &&
    Math.abs(a.screen.x - b.screen.x) < 0.1 &&
    Math.abs(a.screen.y - b.screen.y) < 0.1
  );
}

/** What an item registered: its kind and what to call when it is hit. */
export type RegisteredItem = {
  kind: HitKind;
  handlers: InteractionHandlers;
  /** false = drawn but never picked (a huge background layer, a decoration) */
  interactive: boolean;
};

export type MapInteractionApi = {
  selection: SelectionStore;
  /** the live hover/cursor state (subscribe with `useInteractionState`) */
  state: InteractionState;
  /** id -> handlers, read live by the interaction layer */
  registry: Map<string, RegisteredItem>;
  register: (id: string, item: RegisteredItem) => () => void;
  /** pick programmatically (the layer installs this when an engine is mounted) */
  pick: (x: number, y: number) => MapHit | null;
  /** @internal used by the layer */
  setPicker: (picker: ((x: number, y: number) => MapHit | null) | null) => void;
  tolerancePx: number;
  include?: HitKind[];
};

const InteractionContext = createContext<MapInteractionApi | null>(null);

export function useMapInteraction(): MapInteractionApi {
  const value = useContext(InteractionContext);
  if (!value) throw new Error("RadiumEngine: <MapProvider> is missing above this component");
  return value;
}
export type InteractionProviderProps = {
  children: ReactNode;
  /** extra slack around a hit, in CSS px (touch UIs want ~12) */
  tolerancePx?: number;
  /** restrict what can be clicked at all (`["object"]` for "only aircraft") */
  include?: HitKind[];
  /** bring your own store, e.g. to restore a selection */
  selection?: SelectionStore;
};

/**
 * Makes items clickable. Mounted by `<MapProvider>`, so `useSelection()` and `useHovered()`
 * work anywhere in the tree — a side panel, a status bar, a toolbar.
 */
export function InteractionProvider({
  children,
  tolerancePx = 4,
  include,
  selection,
}: InteractionProviderProps) {
  const selectionRef = useRef<SelectionStore | null>(null);
  if (!selectionRef.current) selectionRef.current = selection ?? new SelectionStore();
  const stateRef = useRef<InteractionState | null>(null);
  if (!stateRef.current) stateRef.current = new InteractionState();
  const registryRef = useRef<Map<string, RegisteredItem>>(new Map());
  const pickerRef = useRef<((x: number, y: number) => MapHit | null) | null>(null);

  const api = useMemo<MapInteractionApi>(
    () => ({
      selection: selectionRef.current as SelectionStore,
      state: stateRef.current as InteractionState,
      registry: registryRef.current,
      register: (id, item) => {
        registryRef.current.set(id, item);
        return () => {
          registryRef.current.delete(id);
        };
      },
      pick: (x, y) => pickerRef.current?.(x, y) ?? null,
      setPicker: (picker) => {
        pickerRef.current = picker;
      },
      tolerancePx,
      include,
    }),
    [tolerancePx, include],
  );

  return <InteractionContext.Provider value={api}>{children}</InteractionContext.Provider>;
}

/* ── hooks ──────────────────────────────────────────────────────────────── */

/** Hover + cursor position; the component re-renders when the pointer moves. */
export function useInteractionState(): InteractionSnapshot {
  const { state } = useMapInteraction();
  return useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
}

export function useHovered(): MapHit | null {
  return useInteractionState().hovered;
}

export function usePointer(): PointerInfo | null {
  return useInteractionState().pointer;
}

export type UseSelectionResult = {
  entries: SelectionEntry[];
  ids: string[];
  has: (id: string) => boolean;
  select: (hit: SelectionEntry | null, options?: { additive?: boolean }) => void;
  setMany: (entries: SelectionEntry[]) => void;
  clear: () => void;
  store: SelectionStore;
};

/** What is selected, and how to change it (survives a 2D <-> 3D flip). */
export function useSelection(): UseSelectionResult {
  const { selection } = useMapInteraction();
  const [entries, setEntries] = useState<SelectionEntry[]>(selection.entries);

  useEffect(() => selection.subscribe(setEntries), [selection]);

  return useMemo<UseSelectionResult>(
    () => ({
      entries,
      ids: entries.map((entry) => entry.id),
      has: (id) => selection.has(id),
      select: (hit, options) => {
        selection.select(hit, options);
      },
      setMany: (next) => {
        selection.setMany(next);
      },
      clear: () => {
        selection.clear();
      },
      store: selection,
    }),
    [entries, selection],
  );
}

export function usePick(): (x: number, y: number) => MapHit | null {
  return useMapInteraction().pick;
}


/**
 * Registers an item is handlers with the interaction layer. Called by the item components,
 * so `<MapObject onClick={...}>` is all an application writes.
 *
 * The wrappers are stable and read the latest handlers from a ref, so changing a callback
 * does not re-register (and does not disturb a running drag).
 */
export function useItemInteraction(
  id: string,
  kind: HitKind,
  handlers: InteractionHandlers,
  options: { interactive?: boolean; enabled?: boolean } = {},
): void {
  const { register } = useMapInteraction();
  const latest = useRef(handlers);
  latest.current = handlers;
  const interactive = options.interactive ?? true;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    return register(id, {
      kind,
      interactive,
      handlers: {
        onClick: (event) => latest.current.onClick?.(event),
        onDoubleClick: (event) => latest.current.onDoubleClick?.(event),
        onContextMenu: (event) => latest.current.onContextMenu?.(event),
        onHover: (event) => latest.current.onHover?.(event),
        onHoverEnd: (event) => latest.current.onHoverEnd?.(event),
      },
    });
  }, [register, id, kind, enabled, interactive]);
}

export type MapInteractionLayerProps = {
  /** extra slack around a hit, in CSS px (defaults to the provider is) */
  tolerancePx?: number;
  /** restrict what this layer picks (defaults to the provider is) */
  include?: HitKind[];
};

/**
 * The listening half: mounted once per `<MapView>`. It reads the scene store the engines
 * draw, hit-tests in screen space, dispatches to the registered handlers and keeps the
 * selection in step (a plain click replaces, ctrl/cmd/shift toggles).
 */
export function MapInteractionLayer({ tolerancePx, include }: MapInteractionLayerProps = {}) {
  const engine = useMapEngine();
  const { store, mode, api, ready } = engine;
  const interaction = useMapInteraction();
  const tolerance = tolerancePx ?? interaction.tolerancePx;
  const kinds = include ?? interaction.include;
  const kindsKey = kinds ? [...kinds].sort().join(",") : "";

  useEffect(() => {
    if (!ready) return;
    const map = api.getEngineMap() as
      | {
          getContainer?: () => HTMLElement;
          getCanvasContainer?: () => HTMLElement;
          getCanvas?: () => HTMLCanvasElement;
          latLngToContainerPoint?: (latlng: [number, number]) => { x: number; y: number };
          containerPointToLatLng?: (point: [number, number]) => { lat: number; lng: number };
          unproject?: (point: [number, number]) => { lat: number; lng: number };
        }
      | null;
    if (!map) return;

    const container =
      (mode === "2d" ? map.getContainer?.() : map.getCanvasContainer?.() ?? map.getCanvas?.()) ?? null;
    if (!container) return;

    /* the projector: the engine is own answer to "which pixel is this position on?" */
    const project: Projector = (lat, lon, alt) => {
      if (mode === "2d") {
        const point = map.latLngToContainerPoint?.([lat, lon]);
        return point ? { x: point.x, y: point.y } : null;
      }
      return screenOf(lon, lat, alt ?? 0);
    };

    const geoAt = (x: number, y: number) => {
      if (mode === "2d") {
        const latlng = map.containerPointToLatLng?.([x, y]);
        return latlng ? { lat: latlng.lat, lon: latlng.lng } : null;
      }
      const latlng = map.unproject?.([x, y]);
      return latlng ? { lat: latlng.lat, lon: latlng.lng } : null;
    };

    const localPoint = (event: MouseEvent): { x: number; y: number } => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    /* only registered items are pickable: a scene nobody listens to costs nothing */
    const candidatesNow = (): HitCandidate[] => {
      const registry = interaction.registry;
      if (registry.size === 0) return [];
      const wanted = kindsKey ? (kindsKey.split(",") as HitKind[]) : undefined;
      return hitCandidates(store.snapshot(), store.tracksList(), { include: wanted }).filter(
        (candidate) => registry.get(candidate.id)?.interactive === true,
      );
    };

    const hitAt = (point: { x: number; y: number }): MapHit | null => {
      const candidates = candidatesNow();
      if (candidates.length === 0) return null;
      return pickAtScreen({ point, candidates, project, tolerancePx: tolerance });
    };

    const payloadFor = (
      hit: MapHit | null,
      point: { x: number; y: number },
      original: unknown,
    ): PointerEventPayload => {
      const geo = geoAt(point.x, point.y);
      return {
        hit,
        pointer: {
          screen: point,
          lat: geo?.lat ?? hit?.lat ?? Number.NaN,
          lon: geo?.lon ?? hit?.lon ?? Number.NaN,
          inside: true,
        },
        original,
      };
    };

    let frame: number | null = null;
    let latestPoint: { x: number; y: number } | null = null;

    const flushHover = () => {
      frame = null;
      const point = latestPoint;
      if (!point) return;
      const hit = hitAt(point);
      const previous = interaction.state.getSnapshot().hovered;
      const geo = geoAt(point.x, point.y);
      interaction.state.update({
        hovered: hit,
        pointer: {
          screen: point,
          lat: geo?.lat ?? Number.NaN,
          lon: geo?.lon ?? Number.NaN,
          inside: true,
        },
      });
      if (!sameHit(hit, previous)) {
        if (previous) interaction.registry.get(previous.id)?.handlers.onHoverEnd?.(payloadFor(previous, point, null));
        if (hit) interaction.registry.get(hit.id)?.handlers.onHover?.(payloadFor(hit, point, null));
      }
      container.style.cursor = hit ? "pointer" : "";
    };

    const onPointerMove = (event: MouseEvent) => {
      latestPoint = localPoint(event);
      if (frame === null) frame = requestAnimationFrame(flushHover);
    };

    const onPointerLeave = () => {
      latestPoint = null;
      const previous = interaction.state.getSnapshot().hovered;
      interaction.state.update({ hovered: null, pointer: null });
      if (previous) interaction.registry.get(previous.id)?.handlers.onHoverEnd?.(payloadFor(previous, { x: 0, y: 0 }, null));
      container.style.cursor = "";
    };

    const onClick = (event: MouseEvent) => {
      const point = localPoint(event);
      const hit = hitAt(point);
      interaction.registry.get(hit?.id ?? "")?.handlers.onClick?.(payloadFor(hit, point, event));
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      interaction.selection.select(entryOf(hit), { additive });
    };

    const onDoubleClick = (event: MouseEvent) => {
      const point = localPoint(event);
      const hit = hitAt(point);
      interaction.registry.get(hit?.id ?? "")?.handlers.onDoubleClick?.(payloadFor(hit, point, event));
    };

    const onContextMenu = (event: MouseEvent) => {
      const point = localPoint(event);
      const hit = hitAt(point);
      const handlers = interaction.registry.get(hit?.id ?? "")?.handlers;
      if (!handlers?.onContextMenu) return;
      event.preventDefault();
      handlers.onContextMenu(payloadFor(hit, point, event));
    };

    container.addEventListener("pointermove", onPointerMove as EventListener);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("click", onClick);
    container.addEventListener("dblclick", onDoubleClick);
    container.addEventListener("contextmenu", onContextMenu);

    /* `api.pick(x, y)` works from anywhere once an engine is mounted */
    interaction.setPicker((x, y) => hitAt({ x, y }));

    return () => {
      container.removeEventListener("pointermove", onPointerMove as EventListener);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDoubleClick);
      container.removeEventListener("contextmenu", onContextMenu);
      if (frame !== null) cancelAnimationFrame(frame);
      interaction.setPicker(null);
      interaction.state.update({ hovered: null, pointer: null });
    };
  }, [ready, mode, api, store, interaction, tolerance, kindsKey]);

  return null;
}
