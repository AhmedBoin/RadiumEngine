// src/three/protocol.ts — serve MapLibre from RadiumEngine's cache.
//
// MapLibre asks for `radium://tiles/<folder>/{z}/{x}/{y}` (imagery) and
// `radium://dem/<folder>/{z}/{x}/{y}` (elevation); both are resolved through the
// shared TilePipeline, so 2D and 3D read the exact same cache and nothing is ever
// downloaded twice.
import type { DemSource, ImageryProvider, TilePipeline, TileSource } from "@radium-engine/core";
import { folderForProvider } from "@radium-engine/core";
import { addProtocol } from "maplibre-gl";

export const TILE_PROTOCOL = "radium";

export function radiumTileUrl(kind: "tiles" | "dem", folder: string): string {
  return `${TILE_PROTOCOL}://${kind}/${folder}/{z}/{x}/{y}`;
}

type Parsed = { kind: "tiles" | "dem"; folder: string; z: number; x: number; y: number };

export function parseRadiumTileUrl(url: string): Parsed | null {
  const match = /^radium:\/\/(tiles|dem)\/(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  if (!match) return null;
  return {
    kind: match[1] as Parsed["kind"],
    folder: match[2],
    z: Number(match[3]),
    x: Number(match[4]),
    y: Number(match[5]),
  };
}

export function imageryTileSource(provider: ImageryProvider): TileSource {
  return {
    id: provider.id,
    url: provider.url,
    subdomains: provider.subdomains,
    tileSize: provider.tileSize ?? 256,
    maxZoom: provider.maxZoom ?? 19,
  };
}

export function demTileSource(source: DemSource): TileSource {
  return { ...source, folder: source.folder };
}

let registered = false;

/** Register the `radium://` protocol once per process. */
export function registerRadiumProtocol(pipeline: TilePipeline): void {
  if (registered) return;
  registered = true;

  addProtocol(TILE_PROTOCOL, async (params) => {
    const parsed = parseRadiumTileUrl(params.url);
    if (!parsed) throw new Error(`radium:// cannot parse "${params.url}"`);

    const source: TileSource =
      parsed.kind === "dem"
        ? { id: parsed.folder, url: "", folder: parsed.folder, encoding: "terrarium" }
        : { id: parsed.folder, url: "", folder: parsed.folder };

    /* the folder identifies the source; the registry below supplies the real URL */
    const known = sourceRegistry.get(parsed.folder) ?? source;
    const data = await pipeline.get(known, { z: parsed.z, x: parsed.x, y: parsed.y });
    return { data };
  });
}

/** folder -> source (so a cache read knows which URL to download from). */
const sourceRegistry = new Map<string, TileSource>();

export function registerTileSource(source: TileSource): TileSource {
  const folder = source.folder ?? folderForProvider(source.id);
  sourceRegistry.set(folder, { ...source, folder });
  return { ...source, folder };
}
