// src/testing/simulate.ts — a deterministic telemetry generator.
//
// Used by the playground, the starter template and unit tests: it produces real
// Pose6 values at a real rate, so motion modes, tracks and drop lines can be seen
// working without a live feed or an aircraft.
import type { Pose6 } from "../types";

export type SimulatedTrafficOptions = {
  /** number of objects */
  count?: number;
  /** centre of the simulated orbits */
  origin?: { lat: number; lon: number };
  /** seconds since the simulation started */
  elapsedSeconds: number;
  /** meters above MSL for the first object */
  baseAltM?: number;
  /** id prefix */
  prefix?: string;
};

export type SimulatedTrack = { id: string; pose6: Pose6 };

/** Pure function: same inputs, same output (easy to assert in tests). */
export function simulateTraffic(options: SimulatedTrafficOptions): SimulatedTrack[] {
  const count = Math.max(0, options.count ?? 3);
  const origin = options.origin ?? { lat: 30.0444, lon: 31.2357 };
  const baseAlt = options.baseAltM ?? 90;
  const prefix = options.prefix ?? "uav";
  const seconds = options.elapsedSeconds;

  return Array.from({ length: count }, (_, index) => {
    const radiusDeg = 0.004 + index * 0.0016;
    const speed = 0.09 + index * 0.03;
    const phase = seconds * speed + index * 2.1;

    return {
      id: `${prefix}-${index + 1}`,
      pose6: {
        lat: origin.lat + Math.sin(phase) * radiusDeg,
        lon: origin.lon + Math.cos(phase * 0.8) * radiusDeg * 1.15,
        alt: baseAlt + index * 45 + Math.sin(seconds * 0.7 + index) * 18,
        roll: Math.sin(phase * 1.3) * 22,
        pitch: Math.cos(phase * 0.9) * 9,
        yaw: (((phase * 57.29578) % 360) + 360) % 360,
      },
    };
  });
}
