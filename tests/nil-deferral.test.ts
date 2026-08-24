import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveMachineDeferredKeys, loadMachineDeferredKeys } from "../src/nil-deferral.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const SHIPPED_SCHEMA = join(import.meta.dirname, "..", "schema");

describe("deriveMachineDeferredKeys", () => {
  it("takes the filament_ keys whose base option belongs to the machine or process schema", () => {
    const deferred = deriveMachineDeferredKeys(
      {
        filament_retraction_length: { type: "float", vector: true },
        filament_bridge_speed: { type: "float", vector: true },
        filament_flow_ratio: { type: "float", vector: true },
        nozzle_temperature: { type: "int", vector: true },
      },
      { retraction_length: { type: "float", vector: true } },
      { bridge_speed: { type: "float", vector: true } }
    );
    expect([...deferred].sort()).toEqual(["filament_bridge_speed", "filament_retraction_length"]);
  });
});

describe("loadMachineDeferredKeys", () => {
  it("derives the family from the fixture schema directory", async () => {
    const deferred = await loadMachineDeferredKeys(join(FIXTURES, "schema"));
    expect([...deferred]).toEqual(["filament_retraction_length"]);
  });

  it("covers both override families in the shipped schemas", async () => {
    const deferred = await loadMachineDeferredKeys(SHIPPED_SCHEMA);
    for (const key of ["filament_retraction_length", "filament_z_hop_types", "filament_wipe", "filament_bridge_speed"]) {
      expect(deferred.has(key)).toBe(true);
    }
    // Filament-owned nullable options keep deferring to the filament chain.
    for (const key of ["filament_flow_ratio", "filament_max_volumetric_speed", "nozzle_temperature"]) {
      expect(deferred.has(key)).toBe(false);
    }
  });
});
