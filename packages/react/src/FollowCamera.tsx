// src/FollowCamera.tsx — declarative camera: "follow object X in mode M".
//
// Drop it next to <MapView /> and the camera takes care of itself:
//
//   <FollowCamera target="drone-1" mode="chase" tuning={{ chasePitchDeg: 40 }} />
//
// It reads the object's INTERPOLATED pose from the scene store every frame (so the
// camera never sees the raw, steppy input), runs it through the {@link CameraRig} and
// pushes the result into whichever engine is mounted: an eye-aware camera move in 3D
// (`applyCameraFrame`), a `panTo` in 2D — a Leaflet map has no eye to place, so the
// eye modes fall back to the centre the frame already carries.
//
// Nothing re-renders React per frame: the loop writes to the map directly, and the
// shared camera state is refreshed at ~4 Hz so widgets stay in step without a render
// storm. Every value the loop reads beyond the store lives in a ref, so a pan by the
// user never restarts (and never fights) the loop.
import { useEffect, useRef } from "react";
import {
  CameraRig,
  type CameraFrame,
  type CameraMode,
  type CameraTuning,
  type FollowTarget,
} from "@radium-engine/core";
import { useMapEngine } from "./context";
import { applyCameraFrame, canvasHeightPx } from "./three/applyCamera";

export type FollowCameraProps = {
  /** id of the object in the scene store to follow (`MapObject id`) */
  target: string | null;
  /** how to follow it; `"free"` hands the camera back to the user */
  mode?: CameraMode;
  /** filter + framing tuning (all optional, see `CameraTuning`) */
  tuning?: CameraTuning;
  /** UI kept clear of the framed object, in CSS pixels */
  paddingPx?: { top?: number; right?: number; bottom?: number; left?: number };
  /** notified with every new frame — throttle it yourself before setting React state */
  onFrame?: (frame: CameraFrame) => void;
};

export function FollowCamera({
  target,
  mode = "follow",
  tuning,
  paddingPx,
  onFrame,
}: FollowCameraProps) {
  const { store, mode: engineMode, camera, elevation, options, api, setCamera } = useMapEngine();

  const rigRef = useRef<CameraRig | null>(null);
  if (!rigRef.current) rigRef.current = new CameraRig(mode, tuning);

  /* everything the animation loop reads lives in a ref: changing any of it must not
     restart the loop (a restart would also re-seed the filter every time the user pans) */
  const live = useRef({ camera, engineMode, options, pad: paddingPx, api, setCamera, onFrame, elevation });
  live.current = { camera, engineMode, options, pad: paddingPx, api, setCamera, onFrame, elevation };

  const tuningKey = JSON.stringify(tuning ?? {});
  useEffect(() => {
    rigRef.current?.configure(JSON.parse(tuningKey) as CameraTuning);
  }, [tuningKey]);

  /* a mode change re-seeds the filter, so the new mode starts ON the object instead of
     gliding in from wherever the old mode happened to be */
  useEffect(() => {
    rigRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    if (target) return;
    rigRef.current?.reset();
  }, [target]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastReport = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const rig = rigRef.current;
      if (!rig || !target) return;

      const { camera: user, engineMode: mode2, options: engineOptions, api: engineApi } = live.current;
      const map = engineApi.getEngineMap() as any;
      if (!map) return;

      const pose = store.displayPose(target);
      const dtMs = last ? Math.min(200, now - last) : 0;
      last = now;

      const frame = rig.update({
        dtMs,
        target: pose ? toFollowTarget(pose) : null,
        viewport: { widthPx: window.innerWidth, heightPx: window.innerHeight },
        user: {
          zoom: user.zoom,
          pitch: user.pitch ?? engineOptions.defaultPitch,
          bearing: user.bearing ?? 0,
        },
        groundAt: (lat, lon) =>
          live.current.elevation && live.current.options.terrain !== false
            ? live.current.elevation.surface(lat, lon, live.current.options.exaggeration)
            : 0,
      });
      if (!frame) return;

      if (mode2 === "2d") {
        /* Leaflet has no eye: pan to the centre the frame already computed (the
           parallax offset is baked into it) */
        if (typeof map.panTo === "function") {
          map.panTo([frame.center.lat, frame.center.lon], { animate: false });
        }
      } else {
        const pad = live.current.pad;
        applyCameraFrame(map, frame, {
          heightPx: canvasHeightPx(map),
          paddingPx: pad
            ? { top: pad.top ?? 0, right: pad.right ?? 0, bottom: pad.bottom ?? 0, left: pad.left ?? 0 }
            : undefined,
        });
        /* Keep the shared camera in step, so widgets (a zoom readout, a mode button)
           agree with what is on screen — at ~4 Hz, not per frame. FPV is skipped on
           purpose: there the zoom is DERIVED from the altitude, so copying it back would
           leave the user with the FPV lens after they leave the mode. */
        if (frame.mode !== "fpv" && now - lastReport > 250) {
          lastReport = now;
          live.current.setCamera({
            lat: frame.center.lat,
            lon: frame.center.lon,
            zoom: frame.zoom,
            pitch: frame.pitch,
            bearing: frame.bearing,
          });
        }
      }

      live.current.onFrame?.(frame);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, target]);

  return null;
}

/** `Pose6` + a heading: exactly what the camera modes need. */
export function toFollowTarget(pose: {
  lat: number;
  lon: number;
  alt: number;
  yaw: number;
  pitch: number;
  roll: number;
}): FollowTarget {
  return {
    lat: pose.lat,
    lon: pose.lon,
    alt: pose.alt,
    heading: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
  };
}
