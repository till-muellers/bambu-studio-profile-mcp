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
