// src/providers/terrain.ts — free elevation (DEM) sources for 3D terrain.
//
// Only TERRAIN data belongs here: no imagery, no RGB/normal maps, so nothing can
// tint the basemap provider. Every entry is free and needs no API key.

/** How elevations are packed into the tile's RGB channels. */
export type DemEncoding = "terrarium" | "mapbox";

export type TerrainProvider = {
  id: string;
  name: string;
  /** URL template ({z}/{x}/{y}); empty for generated/embedded sources. */
  url: string;
  encoding: DemEncoding;
  maxZoom: number;
  tileSize: number;
  /**
   * Cache folder. Kept short and readable, and identical to the folder names
   * Radium already uses, so existing offline caches keep working.
   */
  folder: string;
  /** Tiles come from a local GeoTIFF instead of the network. */
  local?: boolean;
  /** The URL comes from the settings. */
  custom?: boolean;
  /** Remote tiles are GeoTIFFs and are converted to terrarium PNGs on the fly. */
  geotiffTiles?: boolean;
  note?: string;
  group: string;
};

export const TERRAIN_PROVIDERS: TerrainProvider[] = [
  {
    id: "aws-terrarium",
    name: "AWS Terrarium (global, SRTM ~30 m)",
    group: "Global",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    encoding: "terrarium",
    maxZoom: 15,
    tileSize: 256,
    folder: "Terrarium",
    note: "Global. SRTM radar: flat ground can show small bumps.",
  },
  {
    id: "aws-3dep",
    name: "USGS 3DEP (US only, ~10 m bare earth)",
    group: "High accuracy",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif",
    encoding: "terrarium",
    maxZoom: 15,
    tileSize: 256,
    folder: "USGS_3DEP",
    geotiffTiles: true,
    note: "United States only. Bare earth: the most accurate free option there.",
  },
  {
    id: "custom",
    name: "Custom URL (Terrarium)…",
    group: "Custom",
    url: "",
    encoding: "terrarium",
    maxZoom: 15,
    tileSize: 256,
    folder: "Terrarium_Custom",
    custom: true,
    note: "Any {z}/{x}/{y}.png terrain tile server you own.",
  },
  {
    id: "local-geotiff",
    name: "Local GeoTIFF (offline)",
    group: "Custom",
    url: "",
    encoding: "terrarium",
    maxZoom: 12,
    tileSize: 256,
    folder: "LocalDEM",
    local: true,
    note: "Point it at a Copernicus GLO-30 or 3DEP GeoTIFF for your area.",
  },
];

export const DEFAULT_TERRAIN_PROVIDER = "aws-terrarium";

/** The resolved elevation source the pipeline uses. */
export type DemSource = TerrainProvider & {
  /** Cache folder (already includes the smoothing variant). */
  folder: string;
  /** Terrain smoothing passes applied before caching. */
  smoothing: number;
};

export type TerrainOptions = {
  provider?: string;
  customUrl?: string;
  /** 0 = raw data, 1..3 = increasingly smooth (removes SRTM speckle). */
  smoothing?: number;
};

const byId = new Map(TERRAIN_PROVIDERS.map((p) => [p.id, p]));

export function terrainSourceFor(options: TerrainOptions = {}): DemSource {
  const provider = byId.get(options.provider ?? "") ?? byId.get(DEFAULT_TERRAIN_PROVIDER)!;
  const smoothing = Math.max(0, Math.min(3, Math.round(options.smoothing ?? 0)));

  const resolve = (source: TerrainProvider): DemSource => ({
    ...source,
    /* smoothed tiles live in their own folder, so raw and smoothed data never mix */
    folder: smoothing > 0 ? `${source.folder}_S${smoothing}` : source.folder,
    smoothing,
  });

  if (!provider.custom) return resolve(provider);

  const template = (options.customUrl ?? "").trim();
  if (!template.includes("{z}") || !template.includes("{x}") || !template.includes("{y}")) {
    return resolve(byId.get(DEFAULT_TERRAIN_PROVIDER)!);
  }
  return resolve({ ...provider, url: template });
}

/** Terrain tiles needed for a viewport (used by the prefetch API). */
export function isTerrainSourceLocal(source: Pick<DemSource, "local">): boolean {
  return source.local === true;
}

