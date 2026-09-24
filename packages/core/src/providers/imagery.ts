// src/providers/imagery.ts — every basemap RadiumEngine ships with.
//
// Only free/no-key sources plus "bring your own URL": a provider entry is just a
// URL template with {z}/{x}/{y} (and optionally {s} subdomains or {q} quadkey).
import type { Color } from "../types";

export type ImageryProvider = {
  /** Stable id stored in settings. */
  id: string;
  /** Human readable name for pickers. */
  name: string;
  /** URL template: {z} {x} {y} {s} (subdomain) {q} (bing quadkey) */
  url: string;
  attribution?: string;
  subdomains?: ReadonlyArray<string | number>;
  /** Highest native zoom (tiles are over-zoomed above it). */
  maxZoom?: number;
  tileSize?: number;
  /** Tint applied to the tiles (some providers need inverting, e.g. dark maps). */
  tint?: Color;
  /** Grouping for UIs. */
  group: string;
  /** true when the URL comes from the application settings. */
  custom?: boolean;
};

/**
 * All built-in providers. Keep this list flat for lookups, the `group` field
 * keeps the picker tidy.
 */
export const IMAGERY_PROVIDERS: ImageryProvider[] = [
  {
    id: "OpenStreetMap.Standard",
    name: "OpenStreetMap Standard",
    group: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
  },
  {
    id: "OpenStreetMap.HOT",
    name: "OpenStreetMap Humanitarian",
    group: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, Humanitarian",
    subdomains: ["a", "b", "c"],
    maxZoom: 19,
  },
  {
    id: "OpenStreetMap.BlackWhite",
    name: "OpenStreetMap Black & White",
    group: "OpenStreetMap",
    url: "https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  {
    id: "Google.Roadmap",
    name: "Google Roadmap",
    group: "Google",
    url: "https://{s}.google.com/vt/lyrs=r&x={x}&y={y}&z={z}",
    attribution: "© Google",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 21,
  },
  {
    id: "Google.Satellite",
    name: "Google Satellite",
    group: "Google",
    url: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attribution: "© Google",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 21,
  },
  {
    id: "Google.Hybrid",
    name: "Google Hybrid",
    group: "Google",
    url: "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    attribution: "© Google",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 21,
  },
  {
    id: "Google.Terrain",
    name: "Google Terrain",
    group: "Google",
    url: "https://{s}.google.com/vt/lyrs=t&x={x}&y={y}&z={z}",
    attribution: "© Google",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    maxZoom: 21,
  },
  {
    id: "Bing.Road",
    name: "Bing Road",
    group: "Bing",
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/r{q}.jpeg?g=1",
    attribution: "© Bing",
    subdomains: [0, 1, 2, 3],
    maxZoom: 19,
  },
  {
    id: "Bing.Aerial",
    name: "Bing Aerial",
    group: "Bing",
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1",
    attribution: "© Bing",
    subdomains: [0, 1, 2, 3],
    maxZoom: 19,
  },
  {
    id: "Bing.Hybrid",
    name: "Bing Hybrid",
    group: "Bing",
    url: "https://ecn.t{s}.tiles.virtualearth.net/tiles/h{q}.jpeg?g=1",
    attribution: "© Bing",
    subdomains: [0, 1, 2, 3],
    maxZoom: 19,
  },
  {
    id: "ESRI.WorldStreetMap",
    name: "ESRI World Street Map",
    group: "ESRI",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "© ESRI",
    maxZoom: 19,
  },
  {
    id: "ESRI.WorldImagery",
    name: "ESRI World Imagery",
    group: "ESRI",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© ESRI",
    maxZoom: 19,
  },
  {
    id: "ESRI.WorldTopoMap",
    name: "ESRI World Topo Map",
    group: "ESRI",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "© ESRI",
    maxZoom: 19,
  },
  {
    id: "Carto.DarkMatter",
    name: "Carto Dark Matter",
    group: "Carto",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 19,
  },
  {
    id: "Carto.Positron",
    name: "Carto Positron",
    group: "Carto",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 19,
  },
  {
    id: "custom",
    name: "Custom URL…",
    group: "Custom",
    url: "",
    custom: true,
    maxZoom: 22,
  },
];

export const DEFAULT_IMAGERY_PROVIDER = "ESRI.WorldImagery";

const byId = new Map(IMAGERY_PROVIDERS.map((p) => [p.id, p]));

export function imageryProviderFor(
  id: string | undefined,
  customUrl?: string,
): ImageryProvider {
  const provider = byId.get(id ?? "") ?? byId.get(DEFAULT_IMAGERY_PROVIDER)!;
  if (!provider.custom) return provider;
  const template = (customUrl ?? "").trim();
  if (!template.includes("{z}") || !template.includes("{x}") || !template.includes("{y}")) {
    return byId.get(DEFAULT_IMAGERY_PROVIDER)!;
  }
  return { ...provider, url: template };
}

/** Providers grouped for pickers. */
export function imageryProviderGroups(): { group: string; providers: ImageryProvider[] }[] {
  const groups = new Map<string, ImageryProvider[]>();
  for (const provider of IMAGERY_PROVIDERS) {
    const list = groups.get(provider.group) ?? [];
    list.push(provider);
    groups.set(provider.group, list);
  }
  return [...groups].map(([group, providers]) => ({ group, providers }));
}
