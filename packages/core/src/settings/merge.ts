// src/settings/merge.ts — the one merge rule every persisted option goes through.
//
// A stored settings file is *older* than the code that reads it: new fields exist
// that the file has never seen, and a half-written field must not wipe a whole
// branch of the tree. So loading is always `deepMerge(defaults, file)` (defaults
// first: a missing or `undefined` value keeps the default), and a change is always a
// *partial* patch merged into the current tree — never a replacement of it.

/** A patch allowed to name only some of the fields, recursively. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/**
 * Merge `source` into `target`, returning a new object: plain objects merge key by
 * key, arrays and primitives are replaced (a list of waypoints is a value, not a
 * tree). `undefined` never overwrites — that is what makes a patch partial.
 */
export function deepMerge<T extends object>(target: T, source: DeepPartial<T> | undefined): T {
  if (!source) return cloneValue(target);
  const out: Record<string, unknown> = isPlainObject(target) ? { ...(target as any) } : {};

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : cloneValue(value);
  }
  return out as T;
}

/** Structured clone when available (browsers/workers), a JSON copy otherwise. */
export function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fall through (functions, class instances, ...) */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
