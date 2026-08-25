import { describe, expect, it } from "vitest";
import { CircularInheritanceError, ProfileNotFoundError } from "../src/errors.js";
import { resolveProfile } from "../src/resolver.js";
import type { ProfileHit, ReadableProfileKind, ProfileStore, RawProfile } from "../src/types.js";

/** In-memory store; keys are profile names. */
function fakeStore(profiles: Record<string, RawProfile & { source?: "user" | "system" }>): ProfileStore {
  return {
    async findProfile(_kind: ReadableProfileKind, _vendor: string, name: string): Promise<ProfileHit | null> {
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

describe("resolveProfile nil columns", () => {
  it("takes the parent's element for a nil column and reports the index", async () => {
    const store = fakeStore({
      root: { name: "root", outer_wall_speed: ["12", "12", "12"] },
      child: { name: "child", inherits: "root", outer_wall_speed: ["22", "22", "nil"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "child");
    expect(result.settings.outer_wall_speed).toEqual(["22", "22", "12"]);
    expect(result.nilResolved).toEqual({ outer_wall_speed: [2] });
    expect(result.nilUnresolved).toBeUndefined();
  });

  it("resolves an all-nil array entirely from the parent", async () => {
    const store = fakeStore({
      root: { name: "root", outer_wall_speed: ["12", "13", "14"] },
      child: { name: "child", inherits: "root", outer_wall_speed: ["nil", "nil", "nil"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "child");
    expect(result.settings.outer_wall_speed).toEqual(["12", "13", "14"]);
    expect(result.nilResolved).toEqual({ outer_wall_speed: [0, 1, 2] });
  });

  it("carries a grandparent value through a middle level that is itself nil", async () => {
    const store = fakeStore({
      root: { name: "root", outer_wall_speed: ["12", "12", "12"] },
      middle: { name: "middle", inherits: "root", outer_wall_speed: ["18", "18", "nil"] },
      leaf: { name: "leaf", inherits: "middle", outer_wall_speed: ["22", "nil", "nil"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "leaf");
    expect(result.settings.outer_wall_speed).toEqual(["22", "18", "12"]);
    expect(result.nilResolved).toEqual({ outer_wall_speed: [1, 2] });
  });

  it("leaves a nil column past the parent array's end unresolved", async () => {
    const store = fakeStore({
      root: { name: "root", outer_wall_speed: ["12", "12"] },
      child: { name: "child", inherits: "root", outer_wall_speed: ["22", "nil", "nil"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "child");
    expect(result.settings.outer_wall_speed).toEqual(["22", "12", "nil"]);
    expect(result.nilResolved).toEqual({ outer_wall_speed: [1] });
    expect(result.nilUnresolved).toEqual({ outer_wall_speed: [2] });
  });

  it("reports a nil column the root itself declares", async () => {
    const store = fakeStore({ solo: { name: "solo", outer_wall_speed: ["22", "nil"] } });
    const result = await resolveProfile(store, "process", "BBL", "solo");
    expect(result.settings.outer_wall_speed).toEqual(["22", "nil"]);
    expect(result.nilUnresolved).toEqual({ outer_wall_speed: [1] });
    expect(result.nilResolved).toBeUndefined();
  });

  it("omits both report fields when no column is nil", async () => {
    const store = fakeStore({ solo: { name: "solo", outer_wall_speed: ["22", "23"] } });
    const result = await resolveProfile(store, "process", "BBL", "solo");
    expect(result.nilResolved).toBeUndefined();
    expect(result.nilUnresolved).toBeUndefined();
  });

  it("fills a machine-deferred key from the machine's prefix-stripped key", async () => {
    const store = fakeStore({
      root: { name: "root", filament_retraction_length: ["0.5", "0.5", "0.5"] },
      child: { name: "child", inherits: "root", filament_retraction_length: ["1.5", "nil", "nil"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "child", {
      machineDeferredKeys: new Set(["filament_retraction_length"]),
      machineSettings: { retraction_length: ["0.8", "1.2", "0.9"] },
    });
    expect(result.settings.filament_retraction_length).toEqual(["1.5", "1.2", "0.9"]);
    expect(result.nilResolved).toEqual({ filament_retraction_length: [1, 2] });
    expect(result.nilUnresolved).toBeUndefined();
  });

  it("leaves a machine-deferred nil column unresolved without machine settings", async () => {
    const store = fakeStore({
      root: { name: "root", filament_retraction_length: ["0.5", "0.5", "0.5"] },
      child: { name: "child", inherits: "root", filament_retraction_length: ["1.5", "nil", "nil"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "child", {
      machineDeferredKeys: new Set(["filament_retraction_length"]),
    });
    expect(result.settings.filament_retraction_length).toEqual(["1.5", "nil", "nil"]);
    expect(result.nilUnresolved).toEqual({ filament_retraction_length: [1, 2] });
    expect(result.nilResolved).toBeUndefined();
  });

  it("leaves a machine-deferred nil column unresolved when the machine lacks the key", async () => {
    const store = fakeStore({ child: { name: "child", filament_bridge_speed: ["nil", "nil"] } });
    const result = await resolveProfile(store, "filament", "BBL", "child", {
      machineDeferredKeys: new Set(["filament_bridge_speed"]),
      machineSettings: { retraction_length: ["0.8"] },
    });
    expect(result.settings.filament_bridge_speed).toEqual(["nil", "nil"]);
    expect(result.nilUnresolved).toEqual({ filament_bridge_speed: [0, 1] });
  });
});
