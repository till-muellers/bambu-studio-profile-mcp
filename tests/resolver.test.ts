import { describe, expect, it } from "vitest";
import { CircularInheritanceError, ProfileNotFoundError } from "../src/errors.js";
import { resolveProfile } from "../src/resolver.js";
import type { ProfileHit, ProfileKind, ProfileStore, RawProfile } from "../src/types.js";

/** In-memory store; keys are profile names. */
function fakeStore(profiles: Record<string, RawProfile & { source?: "user" | "system" }>): ProfileStore {
  return {
    async findProfile(_kind: ProfileKind, _vendor: string, name: string): Promise<ProfileHit | null> {
      const p = profiles[name];
      if (!p) return null;
      const { source, ...profile } = p;
      return { profile, source: source ?? "system", path: `/fake/${name}.json` };
    },
  };
}

describe("resolveProfile", () => {
  it("merges a chain root-first with child keys overwriting parent keys wholesale", async () => {
    const store = fakeStore({
      root: { name: "root", layer_height: "0.2", outer_wall_speed: ["200", "500", "500"] },
      child: { name: "child", inherits: "root", outer_wall_speed: ["250", "500", "500"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "child");
    expect(result.chain).toEqual(["root", "child"]);
    expect(result.settings).toEqual({
      layer_height: "0.2",
      outer_wall_speed: ["250", "500", "500"],
    });
    expect(result).toMatchObject({ vendor: "BBL", name: "child", kind: "process" });
  });

  it("crosses from a user preset into the system store", async () => {
    const store = fakeStore({
      sys_root: { name: "sys_root", nozzle_temperature: ["220"] },
      "My Filament": { name: "My Filament", inherits: "sys_root", source: "user", nozzle_temperature: ["205"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "My Filament");
    expect(result.chain).toEqual(["sys_root", "My Filament"]);
    expect(result.settings.nozzle_temperature).toEqual(["205"]);
  });

  it("excludes name and inherits from settings", async () => {
    const store = fakeStore({ solo: { name: "solo", layer_height: "0.2" } });
    const result = await resolveProfile(store, "process", "BBL", "solo");
    expect(result.settings).toEqual({ layer_height: "0.2" });
  });

  it("throws ProfileNotFoundError for a missing profile", async () => {
    await expect(resolveProfile(fakeStore({}), "process", "BBL", "ghost")).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });

  it("throws ProfileNotFoundError when a parent in the chain is missing", async () => {
    const store = fakeStore({ orphan: { name: "orphan", inherits: "does_not_exist" } });
    await expect(resolveProfile(store, "process", "BBL", "orphan")).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });

  it("throws CircularInheritanceError on a cycle", async () => {
    const store = fakeStore({
      a: { name: "a", inherits: "b" },
      b: { name: "b", inherits: "a" },
    });
    await expect(resolveProfile(store, "process", "BBL", "a")).rejects.toBeInstanceOf(
      CircularInheritanceError
    );
  });
});
