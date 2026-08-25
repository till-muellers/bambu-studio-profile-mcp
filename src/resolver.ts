import { CircularInheritanceError, ProfileNotFoundError } from "./errors.js";
import type { ReadableProfileKind, ProfileStore, RawProfile, ResolvedProfile } from "./types.js";

/** The element Bambu Studio writes when a nullable vector column defers to its parent value. */
export const NIL = "nil";

/** Prefix the filament override family carries; the machine preset holds the stripped key. */
export const FILAMENT_OVERRIDE_PREFIX = "filament_";

/** Identity keys that never take part in the merged settings. */
const IDENTITY_KEYS = new Set<string>(["name", "inherits"]);

export interface ResolveOptions {
  /**
   * Keys whose `"nil"` columns take their value from the machine preset's prefix-stripped key
   * rather than from the inherits chain.
   */
  machineDeferredKeys?: ReadonlySet<string>;
  /** Resolved settings of the machine preset those keys read their columns from. */
  machineSettings?: Record<string, unknown>;
}

export interface MergedSettings {
  settings: Record<string, unknown>;
  /** Key -> column indices whose value came from a parent rather than from the profile itself. */
  nilResolved?: Record<string, number[]>;
  /** Key -> column indices still `"nil"` because no parent supplied a value at that index. */
  nilUnresolved?: Record<string, number[]>;
}

/**
 * Walks a profile's `inherits` chain and returns it root-first. Throws when a link is missing or
 * the chain closes on itself.
 */
export async function loadChain(
  store: ProfileStore,
  kind: ReadableProfileKind,
  vendor: string,
  name: string
): Promise<RawProfile[]> {
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

  return [...chainLeafFirst].reverse();
}

/** Applies one layer's keys onto the accumulated settings, resolving its `"nil"` columns. */
function mergeLayer(
  settings: Record<string, unknown>,
  layer: RawProfile,
  deferred: ReadonlySet<string>,
  resolvedColumns: Map<string, number[]>
): void {
  for (const [key, value] of Object.entries(layer)) {
    if (IDENTITY_KEYS.has(key)) continue;
    const parent = settings[key];
    resolvedColumns.delete(key);
    if (deferred.has(key) || !Array.isArray(value) || !Array.isArray(parent)) {
      settings[key] = value;
      continue;
    }
    const merged = [...value];
    const filled: number[] = [];
    value.forEach((element, index) => {
      if (element !== NIL) return;
      const inherited = parent[index];
      if (inherited === undefined || inherited === NIL) return;
      merged[index] = inherited;
      filled.push(index);
    });
    settings[key] = merged;
    if (filled.length > 0) resolvedColumns.set(key, filled);
  }
}

/** Fills the override family's remaining `"nil"` columns from the machine preset's settings. */
function applyMachineDeferral(
  settings: Record<string, unknown>,
  deferred: ReadonlySet<string>,
  machineSettings: Record<string, unknown>,
  resolvedColumns: Map<string, number[]>
): void {
  for (const key of deferred) {
    const value = settings[key];
    if (!Array.isArray(value) || !value.includes(NIL)) continue;
    const source = machineSettings[key.slice(FILAMENT_OVERRIDE_PREFIX.length)];
    if (!Array.isArray(source)) continue;
    const merged = [...value];
    const filled = new Set<number>(resolvedColumns.get(key) ?? []);
    value.forEach((element, index) => {
      if (element !== NIL) return;
      const inherited = source[index];
      if (inherited === undefined || inherited === NIL) return;
      merged[index] = inherited;
      filled.add(index);
    });
    settings[key] = merged;
    if (filled.size > 0) resolvedColumns.set(key, [...filled]);
  }
}

/**
 * Merges profile layers root-first: a later layer's keys override an earlier layer's, and a
 * `"nil"` column takes the value the earlier layer supplies at that index. Keys named in
 * `machineDeferredKeys` skip the chain and take their `"nil"` columns from `machineSettings`.
 */
export function mergeChain(layers: RawProfile[], options: ResolveOptions = {}): MergedSettings {
  const deferred = options.machineDeferredKeys ?? new Set<string>();
  const settings: Record<string, unknown> = {};
  const resolvedColumns = new Map<string, number[]>();

  for (const layer of layers) mergeLayer(settings, layer, deferred, resolvedColumns);
  if (options.machineSettings !== undefined) {
    applyMachineDeferral(settings, deferred, options.machineSettings, resolvedColumns);
  }

  const merged: MergedSettings = { settings };
  const nilResolved: Record<string, number[]> = {};
  for (const [key, indices] of resolvedColumns) {
    nilResolved[key] = [...indices].sort((a, b) => a - b);
  }
  const nilUnresolved: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!Array.isArray(value)) continue;
    const remaining = value.flatMap((element, index) => (element === NIL ? [index] : []));
    if (remaining.length > 0) nilUnresolved[key] = remaining;
  }
  if (Object.keys(nilResolved).length > 0) merged.nilResolved = nilResolved;
  if (Object.keys(nilUnresolved).length > 0) merged.nilUnresolved = nilUnresolved;
  return merged;
}

export async function resolveProfile(
  store: ProfileStore,
  kind: ReadableProfileKind,
  vendor: string,
  name: string,
  options: ResolveOptions = {}
): Promise<ResolvedProfile> {
  const chainRootFirst = await loadChain(store, kind, vendor, name);
  return {
    vendor,
    name,
    kind,
    chain: chainRootFirst.map((p) => p.name),
    ...mergeChain(chainRootFirst, options),
  };
}
