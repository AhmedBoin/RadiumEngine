// src/useSimulatedTraffic.ts — a demo/dev helper, not a requirement.
//
// The playground and the starter template use it so the map shows real movement
// immediately; an application replaces it with its own feed (same `pose6` shape).
import { simulateTraffic, type Pose6, type SimulatedTrack } from "@radium-engine/core";
import { useEffect, useMemo, useRef, useState } from "react";

export type UseSimulatedTrafficOptions = {
  /** tick rate in Hz (default 10) */
  rateHz?: number;
  origin?: { lat: number; lon: number };
  baseAltM?: number;
  prefix?: string;
};

/**
 * Returns `{ id, pose6 }` values that move at a realistic rate, as if telemetry
 * were arriving. Every 100 ms by default.
 */
export function useSimulatedTraffic(
  enabled = true,
  count = 3,
  options: UseSimulatedTrafficOptions = {},
): SimulatedTrack[] {
  const [tick, setTick] = useState(0);
  const startedRef = useRef(performance.now());
  const rateHz = options.rateHz ?? 10;
  const origin = options.origin;
  const baseAltM = options.baseAltM;
  const prefix = options.prefix;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000 / Math.max(1, rateHz));
    return () => window.clearInterval(timer);
  }, [enabled, rateHz]);

  return useMemo(
    () =>
      simulateTraffic({
        count,
        origin,
        baseAltM,
        prefix,
        elapsedSeconds: (performance.now() - startedRef.current) / 1000,
      }),
    // `tick` is the clock: the generator is pure, the tick drives it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, tick, origin?.lat, origin?.lon, baseAltM, prefix],
  );
}

export type { Pose6 };
