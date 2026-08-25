import type { ResolvedProfile } from "../types.js";

/**
 * Restrict a resolved settings map to the requested keys, preserving the requested order, and
 * name the requested keys the map lacks. Applied after resolution, so inheritance is unaffected.
 */
export function projectKeys(
  settings: Record<string, unknown>,
  keys: string[]
): { settings: Record<string, unknown>; missingKeys: string[] } {
  const projected: Record<string, unknown> = {};
  const missingKeys: string[] = [];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      projected[key] = settings[key];
    } else if (!missingKeys.includes(key)) {
      missingKeys.push(key);
    }
  }
  return { settings: projected, missingKeys };
}

/** Keeps the nil-column entries whose key survived the projection. */
function projectReport(
  report: Record<string, number[]> | undefined,
  settings: Record<string, unknown>
): Record<string, number[]> | undefined {
  if (report === undefined) return undefined;
  const kept = Object.fromEntries(
    Object.entries(report).filter(([key]) => Object.prototype.hasOwnProperty.call(settings, key))
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Projects a resolved profile onto the requested keys: settings, missingKeys, and the nil-column
 * reports all describe the projected key set.
 */
export function projectResolved<T extends ResolvedProfile>(resolved: T, keys: string[]): T {
  const { settings, missingKeys } = projectKeys(resolved.settings, keys);
  const projected: T = { ...resolved, settings, missingKeys };
  const nilResolved = projectReport(resolved.nilResolved, settings);
  const nilUnresolved = projectReport(resolved.nilUnresolved, settings);
  if (nilResolved === undefined) delete projected.nilResolved;
  else projected.nilResolved = nilResolved;
  if (nilUnresolved === undefined) delete projected.nilUnresolved;
  else projected.nilUnresolved = nilUnresolved;
  return projected;
}
