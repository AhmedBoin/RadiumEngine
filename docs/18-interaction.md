# 18 · Interaction: clicks, hovers, selection and measurement

A map that cannot be clicked is a picture. RadiumEngine picks in **screen space**, through
whichever engine is mounted, so one implementation serves 2D and 3D and what you can click
always matches what you can see:

```tsx
<MapProvider options={{ mode: "3d", … }}>
  <MapView />
  <MapObject id="uav-1" pose6={pose} onClick={({ hit }) => flyTo(hit)} />   {/* clickable */}
  <Track id="uav-1" maxSeconds={120} interactive={false} />               {/* not aimed at */}
</MapProvider>
```

That is the whole API for the common case: **everything you draw is clickable**, and an item
that is decoration (a huge background layer, a drop line) opts out with `interactive={false}`.

## What a handler receives

```ts
<MapObject
  id="uav-1"
  pose6={pose}
  onClick={(event) => {
    event.hit;      // { id, kind, lat, lon, altM, distancePx, point } — or null (a miss)
    event.pointer;  // { screen, lat, lon, inside } — where the CURSOR was, not the item
    event.original; // the raw DOM event
  }}
  onHover={…}
  onHoverEnd={…}
  onDoubleClick={…}
  onContextMenu={…}
/>
```

`hit` is the item, `pointer` is the geography under the cursor — which is what a context menu,
a "place a point here" action or a status bar needs, and why they are separate.

| kind | how it is hit |
| --- | --- |
| `object` | a disc of half its drawn icon size around the object (at its altitude) |
| `marker`, `label` | a disc of pixels around the anchor |
| `circle` | the rim in metres, converted to pixels **through the projector** (exact at any zoom or latitude) |
| `polyline`, `track` | a capsule of the drawn `widthPx` — a 6 px line is 6 px wide to a mouse too |
| `polygon` | inside the ring is a 0 px hit; outside it, the distance to the nearest edge |

Ties go to the closest item, then to what is drawn on top (a marker beats a line, a line beats
a fill), then to `z`. `tolerancePx` (default 4, `~12` for touch) widens everything by a slack
ring, which is what makes a fingertip usable.

## Selection

The interaction layer keeps selection in step with clicks: a plain click selects what you hit
(or clears when you hit nothing), and ctrl/cmd/shift **toggles** (adds what was not selected,
removes what was). The store is engine agnostic, so a selection survives a 2D ⇄ 3D flip.

```tsx
const { ids, entries, has, select, clear } = useSelection();

<ul>{entries.map((entry) => <li key={entry.id}>{entry.kind}: {entry.id}</li>)}</ul>
```

For a headless app the same store is available in core, and a click can be applied by hand:

```ts
import { SelectionStore, pickAtScreen, hitCandidates, entryOf } from "@radium-engine/core";

const selection = new SelectionStore({ multi: true });
const hit = pickAtScreen({ point: { x: 400, y: 300 }, candidates, project: engine.project, tolerancePx: 4 });
selection.select(entryOf(hit), { additive: event.ctrlKey });
```

## Reading the cursor

`usePointer()` and `useHovered()` are backed by an external store read with
`useSyncExternalStore`, so following the mouse does **not** re-render the map tree:

```tsx
function Cursor() {
  const pointer = usePointer();
  const hovered = useHovered();
  if (!pointer) return null;
  return <div>{pointer.lat.toFixed(5)}, {pointer.lon.toFixed(5)} {hovered ? `· ${hovered.id}` : ""}</div>;
}
```

## Picking from code

```ts
const api = useMapApi();
api.pick(x, y);          // the same hit test a click does (null when nothing is pickable)
api.getEngineMap();      // the raw Leaflet / MapLibre map
```
## Measurement and undo (core)

The arithmetic every map app rewrites, spherical and formatted for a UI:

```ts
import {
  pathLengthM, perimeterM, polygonAreaM2, centroid, bearingAlong, formatDistance, formatArea,
  HistoryStore,
} from "@radium-engine/core";

pathLengthM(waypoints);        // metres, great-circle legs
polygonAreaM2(fence);          // m2 (spherical excess, antimeridian-safe)
formatDistance(1423.4);        // "1.42 km"
formatArea(14000);             // "1.40 ha"

const history = new HistoryStore<Scene>({ limit: 100, coalesceMs: 400, initial: scene });
history.push(nextScene, "move waypoint");
history.undo();                // a drag is ONE step: same label inside the window replaces
history.redo();
history.canUndo;               // drive your toolbar
```

Snapshots rather than diffs on purpose: the state of an app built on this engine is a plain
object (`SceneStore` + a settings document), and a snapshot cannot produce the "undo applied to
the wrong version" bug that inverse deltas can.

## What `npm run check:interaction` asserts

* the primitives behave (a segment test falls back to its endpoint, inside/outside a ring);
* a marker/label/object is a disc of pixels, and `tolerancePx` widens it (13 px from a 12 px
  disc is a miss at 0, a 1 px hit at 4);
* a line is a capsule of its **drawn** width (1 px inside a 4 px line, 1 px outside at 3 px);
* the position **on** a line is interpolated, not snapped to a vertex (altitude and longitude
  included);
* a circle converts metres to pixels through the projector (so it is exact at any latitude
  rather than assuming a metres-per-pixel value), and its rim is the boundary;
* a polygon is a 0 px hit inside and an edge distance outside;
* ranking is distance first, then what is drawn on top;
* candidates come from the same store both engines draw (kinds, widths, radii, ids) — with
  tracks namespaced as `track:<object>` so they cannot collide with the object they belong to,
  drop lines excluded, one-point tracks excluded;
* selection replaces on a plain click, toggles on an additive one, and notifies subscribers;
* measurement matches the great circle, closes its ring, never reports a negative area, keeps a
  polygon across the antimeridian small, and formats units for a UI;
* undo/redo walks the history, a gesture coalesces into one step, and the depth limit holds.

## Not implemented (yet), and where it would go

* **draw/edit modes** (click-to-place, drag handles, snapping): the pieces are here —
  `HistoryStore`, `SelectionStore`, `pickAtScreen` — what is missing is a small controller in
  core that owns "the active tool" and a screen-space handle layer per engine;
* **lasso / box selection**: `SelectionStore.setMany` + a screen-space polygon test;
* **clustering**: `hitCandidates` would return one candidate per cluster instead of per item.
