import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePrintConfig } from "../scripts/generate-schema/parse.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "cpp", "print-config-snippet.cpp");

describe("parsePrintConfig (smoke test)", () => {
  it("extracts key, type, vector flag, range, and enum values from definition blocks", async () => {
    const source = await readFile(FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.layer_height).toMatchObject({ type: "float", vector: false, min: 0.04, max: 1.0 });
    expect(options.wall_loops).toMatchObject({ type: "int", vector: false, min: 0 });
    expect(options.enable_support).toMatchObject({ type: "bool", vector: false });
    expect(options.wall_generator).toMatchObject({ type: "enum", vector: false, enum: ["classic", "arachne"] });
    expect(options.outer_wall_speed).toMatchObject({ type: "float", vector: true, min: 0 });
    expect(options.nozzle_temperature).toMatchObject({ type: "int", vector: true, min: 0, max: 350 });
  });
});
