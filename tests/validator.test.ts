import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchema, validateKvps } from "../src/validator.js";
import type { ProfileSchema } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const schema: ProfileSchema = {
  layer_height: { type: "float", vector: false, min: 0.04, max: 1.0, default: 0.2 },
  wall_loops: { type: "int", vector: false, min: 0, max: 1000, default: 2 },
  enable_support: { type: "bool", vector: false, default: false },
  wall_generator: { type: "enum", vector: false, enum: ["classic", "arachne"], default: "classic" },
  sparse_infill_density: { type: "percent", vector: false, min: 0, max: 100, default: 15 },
  outer_wall_speed: { type: "float", vector: true, min: 0, default: 200 },
  notes: { type: "string", vector: false, default: "" },
};

describe("loadSchema", () => {
  it("loads the checked-in fixture schema", async () => {
    const loaded = await loadSchema(join(FIXTURES, "schema", "process.schema.json"));
    expect(loaded.layer_height.type).toBe("float");
    expect(loaded.outer_wall_speed.vector).toBe(true);
  });

  it("names the path when the file is missing", async () => {
    await expect(loadSchema(join(FIXTURES, "schema", "nope.json"))).rejects.toThrow(/nope\.json/);
  });
});

describe("validateKvps", () => {
  it("accepts valid scalars (bare) and vectors (arrays of any length)", () => {
    expect(
      validateKvps(schema, {
        layer_height: "0.28",
        wall_loops: 3,
        enable_support: "1",
        wall_generator: "arachne",
        sparse_infill_density: "25%",
        outer_wall_speed: ["200", "500", "500"],
        notes: "hello",
      })
    ).toEqual([]);
  });

  it("accepts a single-element vector", () => {
    expect(validateKvps(schema, { outer_wall_speed: ["200"] })).toEqual([]);
  });

  it("rejects unknown keys", () => {
    const violations = validateKvps(schema, { bogus_key: "1" });
    expect(violations).toEqual([{ key: "bogus_key", reason: expect.stringContaining("unknown") }]);
  });

  it("rejects an array for a scalar option", () => {
    const violations = validateKvps(schema, { layer_height: ["0.2"] });
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("layer_height");
  });

  it("rejects a bare value for a vector option", () => {
    const violations = validateKvps(schema, { outer_wall_speed: "200" });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("array");
  });

  it("reports per-element vector violations with the element index", () => {
    const violations = validateKvps(schema, { outer_wall_speed: ["200", "-5", "abc"] });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("element 1");
    expect(violations[0].reason).toContain("element 2");
  });

  it("rejects wrong types, out-of-range values, and bad enums — all collected", () => {
    const violations = validateKvps(schema, {
      layer_height: "5.0",
      wall_loops: "2.5",
      wall_generator: "spiral",
      enable_support: "maybe",
    });
    expect(violations.map((v) => v.key).sort()).toEqual([
      "enable_support",
      "layer_height",
      "wall_generator",
      "wall_loops",
    ]);
  });

  it("checks range bounds inclusively", () => {
    expect(validateKvps(schema, { layer_height: "1.0", wall_loops: 0 })).toEqual([]);
  });
});
