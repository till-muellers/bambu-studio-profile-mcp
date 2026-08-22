import { CircularInheritanceError, ProfileNotFoundError } from "./errors.js";
import type { ProfileKind, ProfileStore, RawProfile, ResolvedProfile } from "./types.js";

export async function resolveProfile(
  store: ProfileStore,
  kind: ProfileKind,
  vendor: string,
  name: string
): Promise<ResolvedProfile> {
  const chainLeafFirst: RawProfile[] = [];
  const visited = new Set<string>();
  let current: string | undefined = name;

  while (current !== undefined) {
    if (visited.has(current)) {
      throw new CircularInheritanceError([...visited, current]);
    }
    visited.add(current);
    const hit = await store.findProfile(kind, vendor, current);
    if (!hit) throw new ProfileNotFoundError(kind, current);
    chainLeafFirst.push(hit.profile);
    current = hit.profile.inherits;
  }

  const chainRootFirst = [...chainLeafFirst].reverse();
  const settings: Record<string, unknown> = {};
  for (const profile of chainRootFirst) {
    for (const [key, value] of Object.entries(profile)) {
      if (key === "name" || key === "inherits") continue;
      settings[key] = value;
    }
  }

  return {
    vendor,
    name,
    kind,
    chain: chainRootFirst.map((p) => p.name),
    settings,
  };
}
