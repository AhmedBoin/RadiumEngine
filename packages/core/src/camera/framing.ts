// src/camera/framing.ts — the framing maths every follow camera is built from.
//
// The one rule that makes all of them work: a camera is defined by where its EYE
// is. A map camera can only be *centred* on a point of the GROUND, so an object at
// altitude projects away from its footprint by `alt / metresPerPixel` pixels (~490 px
// at zoom 18 for 100 m) — which is why centring the footprint drifts up-screen as
// soon as the object flies. Every mode below either moves the centre to compensate
// (`followCentreOffsetM`) or places the eye directly (`eyePlacement`,
// `chaseEyePlacement`).
//
// Everything here is pure, so it is verified numerically by `npm run check:camera`:
// none of it can be eyeballed in a headless run.
import { metresPerPixel, mercatorAt, mercatorYToLat } from "../geo/mercator";
import type { LatLng } from "../types";

/** Mean earth circumference, i.e. one mercator unit in metres at the equator. */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

/**
 * MapLibre's mercator transform clamps pitch to its `maxMercatorHorizonAngle`
 * (89.25°) even though `setMaxPitch` would allow more. This is therefore the highest
 * useful map pitch: the horizon then sits on the centre line of the screen, with the
 * sky (drawn by us) above it.
 */
export const HORIZON_PITCH_DEG = 89.25;
/** MapLibre's default vertical field of view. */
export const DEFAULT_FOV_DEG = 36.87;
/** The zoom FPV opens at when the object is higher than this implies. */
export const FPV_MIN_ZOOM = 15;
/** Above this the ground scale is finer than any realistic update rate. */
export const FPV_MAX_ZOOM = 22;

export type ChasePadding = { top: number; right: number; bottom: number; left: number };

/** The followed object's height on screen: 50 = centred, 60 = a little lower. */
export function chaseScreenFraction(percent: number): number {
  const value = Number.isFinite(percent) ? percent : 50;
  return Math.max(10, Math.min(90, value)) / 100;
}

/**
 * Map padding that puts the map centre at `fraction` of the viewport height
 * (0 = top edge, 1 = bottom edge). Read by `chaseScreenY`; MapLibre's own `padding`
 * option does the same thing natively (it only ever shrinks the viewport), which is
 * how a UI header/footer is kept clear of the followed object.
 */
export function chasePadding(heightPx: number, fraction: number): ChasePadding {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 1);
  const f = Math.max(0.05, Math.min(0.95, fraction));
  /* the padded viewport spans [top, height - bottom]; its middle is f * height */
  return f <= 0.5
    ? { top: 0, right: 0, bottom: height * (1 - 2 * f), left: 0 }
    : { top: height * (2 * f - 1), right: 0, bottom: 0, left: 0 };
}

/** Where a point at `fraction` of the viewport height really appears, in CSS px. */
export function chaseScreenY(heightPx: number, fraction: number): number {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 1);
  const padding = chasePadding(height, fraction);
  return (padding.top + (height - padding.bottom)) / 2;
}

/**
 * Screen y (CSS px from the top) of the horizon for a map pitch, on the vertical
 * centre line of the canvas. Pitch is measured from straight down, so the camera
 * looks `90 - pitch` degrees below the horizontal and the horizon appears that many
 * degrees *above* the view axis:
 *
 *   y = height/2 − (height/2) · tan(90° − pitch) / tan(fov/2)
 *
 * At pitch 0 the result is far above the canvas (no sky on screen at all), at 45 it
 * is one viewport above the centre, and at `HORIZON_PITCH_DEG` it is on the centre
 * line. That is where a sky layer anchors its bottom edge.
 */
export function horizonScreenY(
  heightPx: number,
  pitchDeg: number,
  fovDeg: number = DEFAULT_FOV_DEG,
): number {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 800);
  const pitch = Number.isFinite(pitchDeg) ? Math.max(0, Math.min(89.9, pitchDeg)) : 0;
  const fov = Number.isFinite(fovDeg) ? Math.max(1, Math.min(120, fovDeg)) : DEFAULT_FOV_DEG;
  const belowHorizon = ((90 - pitch) * Math.PI) / 180;
  const halfFovTan = Math.tan((fov * Math.PI) / 360);
  return height / 2 - ((height / 2) * Math.tan(belowHorizon)) / halfFovTan;
}

/**
 * The camera's distance to the ground point it is centred on, in metres:
 * `0.5 / tan(fov/2) · heightPx · metresPerPixel`. This is what makes the altitude
 * parallax (`D/(D − altitude)`) grow with zoom: the camera really does sit close to
 * the ground when zoomed in, which is why an object leaves the frame if the camera
 * only follows its footprint.
 */
export function cameraGroundDistanceM(
  heightPx: number,
  latDeg: number,
  zoom: number,
  fovDeg: number = DEFAULT_FOV_DEG,
): number {
  const height = Math.max(1, Number.isFinite(heightPx) ? heightPx : 800);
  const fov = Number.isFinite(fovDeg) ? Math.max(1, Math.min(120, fovDeg)) : DEFAULT_FOV_DEG;
  const mpp = metresPerPixel(
    Number.isFinite(latDeg) ? latDeg : 0,
    Number.isFinite(zoom) ? zoom : 15,
  );
  return (0.5 / Math.tan((fov * Math.PI) / 360)) * height * mpp;
}

/**
 * How far the map centre has to sit AHEAD of the object (along the view bearing), in
 * metres, for the OBJECT — altitude included — to appear at `fraction` of the
 * viewport height. Used by the `follow` mode, which keeps the user's bearing and
 * pitch: this one number cancels the altitude parallax exactly.
 *
 * Set up in the vertical plane through the object, with `f̂` forward and `ẑ` up:
 *
 *   centre      C = A_g + L·f̂                          (footprint + L ahead)
 *   eye         P = C + D·(−sin p·f̂ + cos p·ẑ)          (D = `cameraGroundDistanceM`)
 *   view axis   u = sin p·f̂ − cos p·ẑ
 *   up axis     v = cos p·f̂ + sin p·ẑ
 *   pixel ray   u + s·v,  s = (0.5 − f)·2·tan(fov/2)
 *   object      A = A_g + h·ẑ      (h = its altitude above the centre's plane)
 *
 * Requiring `A − P` to be parallel to `u + s·v` and solving for L gives
 *
 *   t = (h − D·cos p) / (−cos p + s·sin p)
 *   L = D·sin p − (sin p + s·cos p)·t
 *
 * At pitch 0 this reduces to exactly the flat parallax `L = −s·(D − h)`, and at high
 * pitch it places the centre behind the object so that looking along its nose frames
 * it.
 */
export function followCentreOffsetM(options: {
  /** the object's altitude above the centre's plane, metres (`altMsl − ground`) */
  altitudeM: number;
  /** `cameraGroundDistanceM(...)` */
  groundDistanceM: number;
  pitchDeg: number;
  /** where the object should appear, 0..1 from the top of the viewport */
  fraction: number;
  fovDeg?: number;
}): number {
  const h = Number.isFinite(options.altitudeM) ? options.altitudeM : 0;
  const d = Math.max(1, Number.isFinite(options.groundDistanceM) ? options.groundDistanceM : 1);
  const pitch = (Math.max(0, Math.min(89.9, options.pitchDeg ?? 0)) * Math.PI) / 180;
  const f = Number.isFinite(options.fraction)
    ? Math.max(0.05, Math.min(0.95, options.fraction))
    : 0.5;
  const fov = Number.isFinite(options.fovDeg) ? options.fovDeg! : DEFAULT_FOV_DEG;

  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);
  const s = (0.5 - f) * 2 * Math.tan((fov * Math.PI) / 360);

  const denominator = -cosP + s * sinP;
  /* looking straight along the ground plane the centre cannot be solved (the ray
     never crosses it): leave the centre at the footprint and let the framing land */
  if (Math.abs(denominator) < 1e-6) return 0;
  const t = (h - d * cosP) / denominator;
  return d * sinP - (sinP + s * cosP) * t;
}

/**
 * Point `distanceM` away from `origin` on the given bearing, in the MAP's own frame.
 *
 * A map camera lives in Web Mercator: its zoom moves the centre in projected units and
 * its latitudes scale by `cos(lat)`. Offsetting by a great-circle distance instead
 * makes the placement and its inverse disagree (measured: 44 m over a few kilometres,
 * which is the "pinned camera drifts" bug in miniature), so the offset is done in
 * mercator too — same frame, exact inverse, 1:1 with `verticalScreenYFor`.
 */
export function offsetLatLng(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const bearing = (bearingDeg * Math.PI) / 180;
  const unitsPerMetre = 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180));
  const point = mercatorAt(lat, lon);
  const x = point.x + distanceM * Math.sin(bearing) * unitsPerMetre;
  const y = point.y - distanceM * Math.cos(bearing) * unitsPerMetre;
  return { lat: mercatorYToLat(y), lon: x * 360 - 180 };
}

export type EyePlacement = {
  /** where the map has to be centred for the eye to sit at the requested point */
  center: LatLng;
  /** the ground elevation of that centre */
  elevation: number;
  /** the camera's distance to the centre, metres (diagnostics/tests) */
  distanceM: number;
};

/**
 * Where the map camera has to be *centred* so that its EYE sits at a given point with
 * a given view direction — the primitive behind first person and free look.
 *
 * A map camera always orbits its centre: it is placed `D` (the zoom's distance to the
 * ground) along the view axis from the centre, `D·cos(pitch)` above the centre's
 * plane. Turning the view therefore *moves the eye* unless the centre is recomputed,
 * which is why a naive "change the bearing" gives an orbit and not a look-around.
 * Inverting the relation:
 *
 *   center    = eye + D·sin(pitch) along the bearing
 *   elevation = eyeAltMsl − D·cos(pitch)      (the plane the camera aims at)
 *
 * `D` is `metresPerPixel`-based and therefore depends on the *centre's* latitude, which
 * is not known before the centre is — so the placement is evaluated once at the eye's
 * latitude and then corrected with the centre's. Without that step the inverse
 * (`cameraEyeFor`) does not return the eye it was given (measured: 65 m over a 4 km
 * offset, which is exactly what makes a "pinned" camera drift as the pitch changes);
 * with it, the residual is the projection's own distortion over the offset (Web
 * Mercator is only scale-accurate *at* a latitude, ~0.2 % over tens of kilometres) —
 * and the engines use MapLibre's native solver at runtime, which has no such gap.
 *
 * `zoom` stays a pure "lens": it sets D (and the texture scale), not the eye height.
 */
export function eyePlacement(options: {
  eyeLat: number;
  eyeLng: number;
  eyeAltMsl: number;
  bearingDeg: number;
  pitchDeg: number;
  zoom: number;
  heightPx: number;
  fovDeg?: number;
}): EyePlacement {
  const pitchRad = (Math.max(0, Math.min(89.9, options.pitchDeg ?? 0)) * Math.PI) / 180;
  const zoom = Number.isFinite(options.zoom) ? options.zoom : 15;
  const eyeAlt = Number.isFinite(options.eyeAltMsl) ? options.eyeAltMsl : 0;
  const forwardM = (distance: number) => distance * Math.sin(pitchRad);

  let distanceM = cameraGroundDistanceM(options.heightPx, options.eyeLat, zoom, options.fovDeg);
  let center = offsetLatLng(options.eyeLat, options.eyeLng, options.bearingDeg, forwardM(distanceM));
  distanceM = cameraGroundDistanceM(options.heightPx, center.lat, zoom, options.fovDeg);
  center = offsetLatLng(options.eyeLat, options.eyeLng, options.bearingDeg, forwardM(distanceM));

  return {
    center,
    elevation: eyeAlt - distanceM * Math.cos(pitchRad),
    distanceM,
  };
}

export type ChaseEyePlacement = EyePlacement & {
  /** the eye itself */
  eye: { lat: number; lon: number; altMsl: number };
  /** how far behind the object the eye sits, metres along the bearing */
  behindM: number;
  /** how far above it */
  aboveM: number;
  /** eye -> object distance, metres */
  toObjectM: number;
};

/**
 * The chase (third person) placement: the eye sits behind and above the object,
 * aiming along `bearingDeg` with `pitchDeg`, with the OBJECT exactly at `fraction` of
 * the viewport height and `distanceM` from the eye.
 *
 * The geometry is a one-parameter family — with the eye at `E` and the object at `A`,
 * `A − E` only has to be parallel to the pixel ray `u + s·v` — and the free parameter
 * is fixed by the eye-to-object distance (the zoom sets it, so the object keeps a
 * predictable size). With `s = (0.5 − f)·2·tan(fov/2)`, `u = sin p·f̂ − cos p·ẑ` and
 * `v = cos p·f̂ + sin p·ẑ`:
 *
 *   k      = distanceM / √(1 + s²)        (the ray's norm is √(1 + s²))
 *   behind = k·(sin p + s·cos p)
 *   above  = k·(cos p − s·sin p)
 *
 * Verified by `npm run check:camera`, which projects the object through the map
 * camera model built from this placement and asserts it lands on `fraction`.
 */
export function chaseEyePlacement(options: {
  targetLat: number;
  targetLon: number;
  /** the object's altitude, metres MSL */
  targetAltMsl: number;
  /** the view bearing (usually the object's heading) */
  bearingDeg: number;
  pitchDeg: number;
  /** where the object should appear, 0..1 from the top */
  fraction: number;
  /** the eye's zoom (sets `cameraGroundDistanceM` when `distanceM` is omitted) */
  zoom: number;
  heightPx: number;
  fovDeg?: number;
  /** eye -> object distance; defaults to the zoom's ground distance */
  distanceM?: number;
}): ChaseEyePlacement {
  const fov = Number.isFinite(options.fovDeg) ? options.fovDeg! : DEFAULT_FOV_DEG;
  const pitch = Number.isFinite(options.pitchDeg)
    ? Math.max(0, Math.min(89.9, options.pitchDeg))
    : 45;
  const f = Number.isFinite(options.fraction)
    ? Math.max(0.05, Math.min(0.95, options.fraction))
    : 0.5;
  const zoom = Number.isFinite(options.zoom) ? options.zoom : 15;
  const distance =
    Number.isFinite(options.distanceM) && (options.distanceM as number) > 0
      ? (options.distanceM as number)
      : cameraGroundDistanceM(options.heightPx, options.targetLat, zoom, fov);

  const rad = (pitch * Math.PI) / 180;
  const sinP = Math.sin(rad);
  const cosP = Math.cos(rad);
  const s = (0.5 - f) * 2 * Math.tan((fov * Math.PI) / 360);
  const k = distance / Math.sqrt(1 + s * s);

  const behind = k * (sinP + s * cosP);
  const above = k * (cosP - s * sinP);

  const eye = offsetLatLng(options.targetLat, options.targetLon, options.bearingDeg + 180, behind);
  const eyeAltMsl = options.targetAltMsl + above;

  const placement = eyePlacement({
    eyeLat: eye.lat,
    eyeLng: eye.lon,
    eyeAltMsl,
    bearingDeg: options.bearingDeg,
    pitchDeg: pitch,
    zoom,
    heightPx: options.heightPx,
    fovDeg: fov,
  });

  return {
    ...placement,
    eye: { lat: eye.lat, lon: eye.lon, altMsl: eyeAltMsl },
    behindM: behind,
    aboveM: above,
    toObjectM: distance,
  };
}

/**
 * Where the (virtual) eye of the map camera is for a given centre / elevation /
 * pitch / zoom — the inverse of `eyePlacement`. Verified by `npm run check:camera`,
 * and used by it to project a world point exactly the way the engine will.
 */
export function cameraEyeFor(options: {
  centerLat: number;
  centerLon: number;
  /** the centre's ground elevation, metres MSL */
  elevation: number;
  pitchDeg: number;
  bearingDeg: number;
  zoom: number;
  heightPx: number;
  fovDeg?: number;
}): { lat: number; lon: number; altMsl: number; distanceM: number } {
  const pitch = (Math.max(0, Math.min(89.9, options.pitchDeg ?? 0)) * Math.PI) / 180;
  const distanceM = cameraGroundDistanceM(
    options.heightPx,
    options.centerLat,
    options.zoom,
    options.fovDeg,
  );
  const eye = offsetLatLng(
    options.centerLat,
    options.centerLon,
    options.bearingDeg + 180,
    distanceM * Math.sin(pitch),
  );
  return {
    lat: eye.lat,
    lon: eye.lon,
    altMsl: options.elevation + distanceM * Math.cos(pitch),
    distanceM,
  };
}

/**
 * Project a point the way the map camera draws it: CSS pixels from the top of the
 * canvas, `null` when it is behind the camera.
 *
 * A small model of MapLibre's mercator camera on the vertical centre line (the tests
 * assert the vertical framing, which is what follow modes get wrong): the ground
 * plane uses Web Mercator's own scale, altitude enters exactly as MapLibre does, and
 * the axes are the same `u` / `v` the framing maths uses. Its purpose is to let
 * `npm run check:camera` prove that a placement really puts the object where the mode
 * promises, instead of only proving the construction is self-consistent.
 */
export function verticalScreenYFor(options: {
  centerLat: number;
  centerLon: number;
  elevation: number;
  pitchDeg: number;
  bearingDeg: number;
  zoom: number;
  heightPx: number;
  fovDeg?: number;
  lat: number;
  lon: number;
  altMsl: number;
}): number | null {
  const fov = Number.isFinite(options.fovDeg) ? options.fovDeg! : DEFAULT_FOV_DEG;
  const height = Math.max(1, options.heightPx);
  const eye = cameraEyeFor(options);

  /* local east / north / up metres relative to the eye. One mercator unit is 360° of
     longitude, i.e. `earthCircumference · cos(lat)` metres, in x and y alike, because
     Web Mercator is locally isotropic. */
  const metresPerUnit =
    2 * Math.PI * 6378137 * Math.cos((options.centerLat * Math.PI) / 180);
  const mercatorX = (lon: number) => ((lon + 180) / 360) * metresPerUnit;
  const mercatorY = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return -(0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * metresPerUnit;
  };
  const east = mercatorX(options.lon) - mercatorX(eye.lon);
  const north = mercatorY(options.lat) - mercatorY(eye.lat);
  const up = options.altMsl - eye.altMsl;

  const bearingRad = (options.bearingDeg * Math.PI) / 180;
  const forward = north * Math.cos(bearingRad) + east * Math.sin(bearingRad);
  const pitch = (Math.max(0, Math.min(89.9, options.pitchDeg)) * Math.PI) / 180;
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);

  const depth = forward * sinP - up * cosP;
  if (depth <= 1e-6) return null;
  const screenUp = forward * cosP + up * sinP;
  return height / 2 - ((screenUp / depth) * (height / 2)) / Math.tan((fov * Math.PI) / 360);
}
