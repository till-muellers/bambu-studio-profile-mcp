import { join } from "node:path";
import { FILAMENT_OVERRIDE_PREFIX } from "./resolver.js";
import type { ProfileSchema } from "./types.js";
import { loadSchema } from "./validator.js";

/**
 * The filament override family: every `filament_<base>` option whose base option belongs to the
 * machine or the process schema. Bambu Studio synthesizes exactly these keys from its
 * `filament_extruder_override_keys` and `filament_overhang_override_keys` lists, and a `"nil"`
 * column on one of them takes its value from the machine preset's `<base>` key.
 */
export function deriveMachineDeferredKeys(
  filamentSchema: ProfileSchema,
  machineSchema: ProfileSchema,
  processSchema: ProfileSchema
): Set<string> {
  const deferred = new Set<string>();
  for (const key of Object.keys(filamentSchema)) {
    if (!key.startsWith(FILAMENT_OVERRIDE_PREFIX)) continue;
    const base = key.slice(FILAMENT_OVERRIDE_PREFIX.length);
    if (base in machineSchema || base in processSchema) deferred.add(key);
  }
  return deferred;
}

const cache = new Map<string, Promise<ReadonlySet<string>>>();

/** Reads the three schemas in `schemaDir` and derives the override family once per directory. */
export function loadMachineDeferredKeys(schemaDir: string): Promise<ReadonlySet<string>> {
  const cached = cache.get(schemaDir);
  if (cached) return cached;
  const pending = (async () => {
    const [filament, machine, process] = await Promise.all([
      loadSchema(join(schemaDir, "filament.schema.json")),
      loadSchema(join(schemaDir, "machine.schema.json")),
      loadSchema(join(schemaDir, "process.schema.json")),
    ]);
    return deriveMachineDeferredKeys(filament, machine, process) as ReadonlySet<string>;
  })();
  cache.set(schemaDir, pending);
  return pending.catch((error: unknown) => {
    cache.delete(schemaDir);
    throw error;
  });
}
