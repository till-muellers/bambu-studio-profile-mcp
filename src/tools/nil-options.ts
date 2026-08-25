import { loadMachineDeferredKeys } from "../nil-deferral.js";
import { resolveProfile, type ResolveOptions } from "../resolver.js";
import type { ProfileStore, ReadableProfileKind } from "../types.js";
import type { ToolDeps } from "./deps.js";

/**
 * Builds the nil-resolution options for one resolve call. Filament resolution carries the override
 * family; naming a machine preset resolves it so those columns can read the printer's values.
 */
export async function nilResolutionOptions(
  deps: ToolDeps,
  store: ProfileStore,
  kind: ReadableProfileKind,
  vendor: string,
  machineName: string | undefined
): Promise<ResolveOptions> {
  if (kind !== "filament") return {};
  const machineDeferredKeys = await loadMachineDeferredKeys(deps.schemaDir);
  if (machineName === undefined) return { machineDeferredKeys };
  const machine = await resolveProfile(store, "machine", vendor, machineName);
  return { machineDeferredKeys, machineSettings: machine.settings };
}
