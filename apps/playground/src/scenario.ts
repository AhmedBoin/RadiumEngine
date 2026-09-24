import {
  IMAGERY_PROVIDERS,
  TERRAIN_PROVIDERS,
  type CameraMode,
  type LatLngAlt,
  type MapMode,
} from "@radium-engine/react";

/** A mission path (also used for the altitude profile). */
export const MISSION_PATH: LatLngAlt[] = [
  { lat: 30.0444, lon: 31.2357, alt: 120 },
  { lat: 30.0485, lon: 31.2431, alt: 140 },
  { lat: 30.0521, lon: 31.2522, alt: 165 },
  { lat: 30.0558, lon: 31.2613, alt: 180 },
  { lat: 30.0602, lon: 31.2705, alt: 210 },
  { lat: 30.0641, lon: 31.2794, alt: 195 },
];

export const FENCE: { lat: number; lon: number }[] = [
  { lat: 30.052, lon: 31.238 },
  { lat: 30.059, lon: 31.244 },
  { lat: 30.062, lon: 31.258 },
  { lat: 30.054, lon: 31.263 },
  { lat: 30.047, lon: 31.252 },
];

export const ICON_AIRCRAFT = `<svg width="48" height="48" viewBox="0 0 48 48">
  <g transform="rotate(0 24 24)">
    <path d="M24 6 L28 22 L42 30 L42 34 L28 30 L27 38 L32 42 L32 45 L24 42 L16 45 L16 42 L21 38 L20 30 L6 34 L6 30 L20 22 Z"
      fill="#ff2d2d" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
  </g>
</svg>`;

export const ICON_GROUND = `<svg width="30" height="30" viewBox="0 0 30 30">
  <rect x="4" y="4" width="22" height="22" rx="4" fill="#1e88e5" stroke="#ffffff" stroke-width="2"/>
  <circle cx="15" cy="15" r="4" fill="#ffffff"/>
</svg>`;

export const imageryOptions = IMAGERY_PROVIDERS.map((provider) => ({
  id: provider.id,
  label: `${provider.group} / ${provider.name}`,
}));

export const terrainOptions = TERRAIN_PROVIDERS.map((provider) => ({
  id: provider.id,
  label: `${provider.group} / ${provider.name}`,
}));

export type UiState = {
  mode: MapMode;
  imagery: string;
  terrain: string;
  terrainEnabled: boolean;
  smoothing: number;
  exaggeration: number;
  motion: "smooth" | "jump";
  dropLines: boolean;
  objects: number;
  /** camera: how the view follows the first simulated object */
  cameraMode: CameraMode;
  /** camera: where the followed object sits on screen (50 = centred) */
  screenFractionPct: number;
  /** FPV only: the bolted camera's mount angle */
  fpvMountPitchDeg: number;
};

export const CAMERA_MODES: { id: CameraMode; label: string }[] = [
  { id: "free", label: "Free (you fly)" },
  { id: "follow", label: "Follow (auto pan)" },
  { id: "chase", label: "Chase (3rd person)" },
  { id: "fpv", label: "FPV (first person)" },
];

/** The persisted settings document: options + the camera the user tuned. */
export const PLAYGROUND_SETTINGS_DEFAULTS: UiState = {
  mode: "3d",
  imagery: "ESRI.WorldImagery",
  terrain: "aws-terrarium",
  terrainEnabled: true,
  smoothing: 1,
  exaggeration: 1.3,
  motion: "smooth",
  dropLines: true,
  objects: 3,
  cameraMode: "free",
  screenFractionPct: 55,
  fpvMountPitchDeg: 0,
};
