# 13. Performance

What is expensive, what is free, and the knobs that matter.

## The frame budget

```
60 FPS  =  16.6 ms per frame
      ├── MapLibre renders the basemap + terrain   (the heavy part, GPU)
      ├── one fat-line draw call for all lines     (< 1 ms for thousands of segments)
      ├── DOM marker transform per object          (~0.02 ms each)
      └── React re-renders                         (only when your data changes)
```

The two rules that keep this true:

1. **The engines read the store imperatively.** A 10 Hz telemetry feed does not
   re-render your React tree; only the frames that need it are painted.
2. **Geometry is rebuilt only when data or zoom really changed.** The line layer
   signature-checks colour, point count, a position digest and the zoom level, so
   panning does not re-tessellate a mission path.

## How many objects?

| objects | tracks | 3D on integrated GPU | note |
| --- | --- | --- | --- |
| 1–50 | 1–50 | comfortable, 60 FPS | typical fleet view |
| 50–300 | up to 50 | comfortable | markers are DOM, lines are GPU |
| 300–1000 | few | playable, marker DOM cost becomes visible | consider hiding labels |
| 1000+ | – | plan for a custom three.js instanced layer | documented as the roadmap item `three/modelsLayer.ts` |

Cheap wins when you go big:

- `motion={{ mode: "jump" }}` for objects nobody watches closely (no per-frame work),
- put tracks on `maxMetres` (e.g. 3000) instead of `maxSeconds` — fewer points per line,
- skip drop lines for distant objects (`dropLine={isSelected}`),
- labels are the most expensive marker type (text layout) — render them only for the
  visible/selected objects.

## Tile and network tuning

| knob | default | advice |
| --- | --- | --- |
| `TilePipeline({ concurrency })` | 6 | match the browser limit (6) or go higher in Tauri; large numbers just queue |
| `prefetch({ concurrency })` | 6 (TS) / 16 (Rust) | 16–24 in Rust, 6–8 in the browser |
| `cache.maxBytes` | 64 MB | memory L1; 32–64 MB is plenty for a desktop map |
| `exaggeration` | 1 | does not affect cost |
| `terrain` | on | `terrain: false` removes the DEM pass entirely (fastest 3D) |
| `smoothing` | 0 | costs one decode+encode **once per tile**, then it is cached |

The engine hides the hillshade layer while the camera moves, which is the single biggest
3D gesture optimization available (it is a full extra render of the DEM).

## Motion tuning vs. CPU

`smooth` mode keeps 32 samples per object and interpolates with Catmull-Rom only when a
pose actually changed. Cost per object per frame is a handful of arithmetic operations —
negligible until thousands of objects.

If you feed 20 Hz+ telemetry:

- keep `lagMs` around 1.5× the interval (so the buffer always has two samples to
  interpolate between),
- do not raise the pose through React state — call `store.setPose()` from the socket
  callback (see [recipe 5](./12-integration-recipes.md#5-driving-the-map-from-non-react-code)),
- `maxExtrapolationMs` only matters when the feed stops.

## Memory

| what | how much |
| --- | --- |
| decoded DEM tiles (LRU) | 24 tiles × 256×256 × 4 B ≈ 6 MB max |
| elevation point cache | ~100 B per unique position (5 decimals) |
| per track | 32 bytes per point (`{lat, lon, alt, t}`), capped by your limits |
| memory L1 tile cache | `maxBytes` (64 MB default) |
| three.js line buffers | ~12 bytes per vertex; a 10k-point track with splines ≈ 0.5 MB |

If a long session grows, the usual cause is an unbounded track: set `maxPoints` /
`maxSeconds` / `maxMetres`.

## Measuring

```tsx
const { pipeline } = useMapEngine();

// cache hit rate tells you if the network is the problem at all
new TilePipeline({ cache, onEvent: (event) => console.count(event.type) });

// frame timing around an interaction
const measure = async (label: string, work: () => Promise<void>) => {
  const before = performance.now();
  await work();
  console.log(label, (performance.now() - before).toFixed(1), "ms");
};
```

Chrome DevTools profile: the `render` function of `radium-engine-lines` and
`radium-engine-markers` are the two RadiumEngine frames in the flame chart; if they
appear there and the budget is blown, look at the number of tracks/objects, not at React.

## Things that are deliberately not done

- **No re-tessellation while panning**: line geometry is zoom-quantised (its signature
  includes `log2(1/unitsPerPixel)`), so a zoom level change rebuilds once.
- **No per-frame React work**: markers read the store directly.
- **No texture for text**: labels are DOM/CSS.
- **No RGB terrain or normal-map passes**: terrain is one raster-dem, which is why
  turning terrain off is so cheap.

Next: [troubleshooting](./14-troubleshooting.md).
