# 16 · Camera: following an object

A map camera can only be **centred on a point of the ground**, and everything that follows
a moving object gets that wrong in the same way: an object at altitude projects away from
its footprint by `altitude / metresPerPixel` pixels — about **490 px at zoom 18 for
100 m** — so centring the footprint lets it drift up the screen as soon as it climbs.
RadiumEngine has one camera system, built on eye placement instead of guesswork, and it is
verified numerically (`npm run check:camera`) because none of it can be eyeballed in a
headless run.

```tsx
<MapProvider options={{ mode: "3d", … }}>
  <MapView />
  {/* one line, four modes */}
  <FollowCamera target="drone-1" mode="chase" tuning={{ chasePitchDeg: 42, screenFractionPct: 60 }} />
</MapProvider>
```

## The four modes

| mode | what moves | what stays yours | typical use |
| --- | --- | --- | --- |
| `free` | nothing — the camera is the user's | everything | inspection, planning |
| `follow` | the map centre tracks the object | bearing, pitch, zoom | "auto pan": watch a route |
| `chase` | the **eye** sits behind and above the object | zoom (sets the distance) | third person, games, demos |
| `fpv` | the **eye is the object** | nothing (the object flies it) | first person, camera drones |

Every mode keeps the object at `screenFractionPct` of the viewport (50 = centred, 60 = a
little lower so more of the route ahead is visible). That single number is what the
framing maths solves for; it is a **screen position, not a distance**, so zooming never
moves the object out of view.

```ts
type CameraTuning = {
  positionMs?: number;          // follow filter: position response time
  angleMs?: number;             // follow filter: attitude response time
  speedLimitMps?: number;       // how fast the view may chase a teleport
  screenFractionPct?: number;   // where the object sits on screen (50 = centre)
  chasePitchDeg?: number;       // chase camera pitch
  chaseDistanceM?: number;      // chase camera distance (default: from the zoom)
  fpvModel?: "fixed" | "gimbal";// bolted, or stabilised to the horizon
  fpvMountPitchDeg?: number;    // the bolted camera's angle (positive looks up)
  fovDeg?: number;              // the virtual lens
  zoomOffset?: number;          // extra FPV zoom on top of the altitude-derived one
};
```

## What actually happens per frame

```
SceneStore.displayPose(id)     ← interpolated, smooth (never the raw feed)
   │
   ├─ limitFollowTarget(previous, target, dt, tuning)   a 500 m teleport is chased at
   │                                                    speedLimitMps, not copied
   ├─ stepCameraFollow(state, …)                        alpha-beta (g-h) filter: critically
   │                                                    damped, zero lag on a steady target
   └─ CameraRig.frameFor(pose, viewport, user)          the framing maths, per mode
        │
        └─ applyCameraFrame(map, frame)                 jumpTo (centre) or the map's own
                                                        inverse solver (eye)
```

Two properties are worth knowing, because they are the difference between "works on a
demo" and "works on a real feed":
## The maths, in one place

| function | what it answers |
| --- | --- |
| `chaseScreenFraction(percent)` | the screen fraction, clamped to 10–90 % |
| `chasePadding(height, fraction)` / `chaseScreenY` | the MapLibre padding that puts the framed object at that fraction |
| `cameraGroundDistanceM(height, lat, zoom, fov)` | the camera's distance to the ground it is centred on (the `D` of the parallax) |
| `followCentreOffsetM({ altitudeM, groundDistanceM, pitchDeg, fraction })` | how far **ahead** of the object the map centre must sit so the object lands on `fraction` — the parallax cancelled in closed form |
| `eyePlacement({ eyeLat, eyeLng, eyeAltMsl, bearing, pitch, zoom, heightPx })` | where the map must be centred for its **eye** to be at a point (FPV, free look) |
| `chaseEyePlacement({ … })` | the eye behind *and above* the object, with the object exactly at the fraction |
| `fpvPitch(horizon, objectPitch)` | the FPV view pitch: a dive tilts the view down, a climb stops at the horizon |
| `fpvZoomForAltitude(alt, lat, height, fov)` ⇄ `fpvEyeAltitudeForZoom` | the lens: the ground drawn at the scale an eye `alt` metres up sees |
| `fpvAttitude({ model, … })` | which freedoms each FPV model gives the object |
| `horizonScreenY(height, pitch, fov)` | where a sky layer anchors its bottom edge |
| `verticalScreenYFor(frame, …)` | the map-camera model, used by the checks to prove a frame puts the object where it promised |

`HORIZON_PITCH_DEG = 89.25`: MapLibre's mercator transform clamps pitch there even though
`setMaxPitch` allows more, so it is the highest useful map pitch — the horizon is then on
the centre line. **A mercator map cannot show sky**, which is why an FPV view looks
flat-topped; a sky layer of your own is the only way to gain it.

## Imperative use (no React)

```ts
import { CameraRig } from "@radium-engine/core";

const rig = new CameraRig("chase", { chasePitchDeg: 40, screenFractionPct: 60 });
let last = 0;

function frame(now: number, pose: FollowTarget) {
  const dtMs = last ? now - last : 0;      // 0 = place the camera, do not glide
  last = now;
  const camera = rig.update({
    dtMs,
    target: pose,
    viewport: { widthPx: innerWidth, heightPx: innerHeight },
    user: { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
    groundAt: (lat, lon) => elevation?.surface(lat, lon, 1) ?? 0,
  });
  if (camera) applyCameraFrame(map, camera);   // exported by @radium-engine/react
}
```

`mode: "free"` returns `null` and touches nothing — the user's camera stays theirs.

## In 2D

The flat engine has no eye to place, so `follow` is a `panTo` of the frame's centre (which
already carries the parallax offset) and `chase` / `fpv` fall back to it. Flipping between
2D and 3D therefore keeps you looking at the same object, one view flatter than the other.

## What `npm run check:camera` asserts

* the chase and follow framings put the object at the requested screen fraction — asserted
  by **projecting** the object through the map-camera model over a grid of zoom / pitch /
  altitude / fraction (worst < 2 px), not by trusting the algebra that produced it;
* centring the footprint instead would drift it by hundreds of pixels (the bug this
  replaces, measured);
* an eye placement round-trips through the same model, and a chase eye is always *above*
  and *behind* the object;
* the FPV lens round-trips (zoom ⇄ altitude), the pitch never looks below 45°, and the two
  camera models keep their promises (fixed banks and pitches with the object, gimbal does
  not);
* the follow filter is seeded, never overshoots, has no lag on a steady target, and limits
  a teleport to `speedLimitMps · dt`;
* the rig drives all four modes, and a mode change re-seeds the filter.


* **The filter is seeded.** The first frame places the camera *on* the object. A fresh
  state sits at (0, 0), and a rate limit applied from there asks the camera to crawl
  towards the object at `speedLimitMps` — thousands of kilometres, i.e. hours. That is not
  hypothetical: it was `"the view moved to 0,0 and never arrived"`.
* **The filter never overshoots.** A discrete alpha-beta pair predicts past the target and
  then keeps it there (measured 13 % overshoot); the value is pinned to the near side of
  the target, measured from the previous value, so following is monotone. A constant
  velocity target is still tracked with **zero steady-state lag**, so following does not
  drag behind in normal motion.
