# 7. Providers — imagery and terrain

## Imagery providers

```tsx
<MapProvider options={{ imagery: "ESRI.WorldImagery" }}>
```

| id | group | max zoom | notes |
| --- | --- | --- | --- |
| `OpenStreetMap.Standard` | OSM | 19 | classic OSM street map |
| `OpenStreetMap.HOT` | OSM | 19 | humanitarian styling, good for crisis areas |
| `OpenStreetMap.BlackWhite` | OSM | 19 | print / minimal |
| `Google.Roadmap` | Google | 21 | roads, labels |
| `Google.Satellite` | Google | 21 | imagery only |
| `Google.Hybrid` | Google | 21 | imagery + labels |
| `Google.Terrain` | Google | 21 | shaded relief + roads |
| `Bing.Road` | Bing | 19 | uses quadkey tiles (`{q}`) |
| `Bing.Aerial` | Bing | 19 | quadkey |
| `Bing.Hybrid` | Bing | 19 | quadkey |
| `ESRI.WorldStreetMap` | ESRI | 19 | |
| `ESRI.WorldImagery` | ESRI | 19 | **default**, good global imagery |
| `ESRI.WorldTopoMap` | ESRI | 19 | topography |
| `Carto.DarkMatter` | Carto | 19 | dark UI friendly |
| `Carto.Positron` | Carto | 19 | light UI friendly |
| `custom` | Custom | 22 | your own `{z}/{x}/{y}` template |

```ts
import { IMAGERY_PROVIDERS, DEFAULT_IMAGERY_PROVIDER, imageryProviderGroups } from "@radium-engine/core";
```

- `IMAGERY_PROVIDERS` → the flat list above (each entry: `{ id, name, group, url, attribution, subdomains, maxZoom, tileSize, custom }`).
- `imageryProviderGroups()` → `{ group, providers }[]`, ready for a picker (the playground uses it).
- `imageryProviderFor(id, customUrl?)` → the resolved provider, with a safe fallback to
  the default when the id is unknown or the custom template is invalid.

## Custom imagery

```tsx
<MapProvider
  options={{
    imagery: {
      url: "https://tiles.example.com/{z}/{x}/{y}.png",
      subdomains: ["a", "b"],                       // optional, replaces {s}
      attribution: "© My Tiles",
      maxZoom: 18,
    },
  }}
>
```

Placeholders understood by both engines: `{z}`, `{x}`, `{y}`, `{s}` (subdomain),
`{q}` (Bing quadkey) and `{-y}` (TMS, y counted from the south). A template must
contain `{z}`, `{x}` and `{y}` or it is rejected and the default provider is used.

The subdomain is picked deterministically from the tile coordinates, so the same tile
always maps to the same host — that is what keeps the HTTP cache effective.

## Terrain providers

```tsx
<MapProvider options={{ terrain: { provider: "aws-3dep", smoothing: 2 } }}>
<MapProvider options={{ terrain: false }}>            // flat 3D map, no DEM traffic
```

| id | group | coverage / resolution | max zoom | cache folder |
| --- | --- | --- | --- | --- |
| `aws-terrarium` | Global | worldwide, SRTM ~30 m | 15 | `Terrarium` |
| `aws-3dep` | High accuracy | United States, **bare earth ~10 m** | 15 | `USGS_3DEP` |
| `custom` | Custom | your own terrarium server | 15 | `Terrarium_Custom` |
| `local-geotiff` | Custom | your own GeoTIFF (Copernicus GLO-30, 3DEP) — fully offline | 12 | `LocalDEM` |

- All four are free and need no API key.
- `aws-3dep` publishes **GeoTIFF** tiles; RadiumEngine converts them to terrarium PNGs
  once and caches the result, so MapLibre can use them and they keep working offline.
  This needs the optional `geotiff` peer.
- Only terrain data lives here (never RGB/normal maps), so nothing can tint your
  imagery.
- `terrainSourceFor({ provider, customUrl, smoothing })` returns a `DemSource`
  (`{ ...provider, folder, smoothing }`), and with `smoothing > 0` the folder becomes
  `Terrarium_S1` … `Terrarium_S3`, keeping smoothed and raw tiles in separate caches.

Which one should you use?

| situation | choice |
| --- | --- |
| anywhere on earth, quick | `aws-terrarium` (default) |
| flying in the US and you want the real ground surface | `aws-3dep` |
| flat ground looks bumpy | any provider with `smoothing: 1` or `2` |
| a specific area you own, offline forever | `local-geotiff` (or prefetch a region) |
| no terrain at all (2.5D city view, fastest) | `terrain: false` |

## Attribution

Attribution strings come from the provider table and are shown by both engines when
`attribution` is true (default). For Google/Bing/ESRI tiles, check the provider's terms
for your use case before shipping; the table gives you the string to display, not the
licence.

## Switching providers at runtime

```tsx
const [imagery, setImagery] = useState("ESRI.WorldImagery");
const [terrain, setTerrain] = useState("aws-terrarium");

<MapProvider options={{ imagery, terrain: { provider: terrain, smoothing: 1 } }}>…</MapProvider>

<select onChange={(e) => setImagery(e.target.value)}>{/* … */}</select>
```

The provider tracks the change: the 3D style is rebuilt, the 2D tile layer swaps, and
each provider keeps its own cache folder — so switching back is instant and offline.

Next: [caching and offline](./08-cache-offline.md).
