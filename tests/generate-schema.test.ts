import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOptionList, parsePrintConfig } from "../scripts/generate-schema/parse.js";

const PRINT_CONFIG_FIXTURE = join(import.meta.dirname, "fixtures", "cpp", "print-config-snippet.cpp");
const PRESET_FIXTURE = join(import.meta.dirname, "fixtures", "cpp", "preset-snippet.cpp");

describe("parsePrintConfig (smoke test)", () => {
  it("extracts key, type, vector flag, range, and enum values from definition blocks", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.layer_height).toMatchObject({ type: "float", vector: false, min: 0.04, max: 1.0 });
    expect(options.wall_loops).toMatchObject({ type: "int", vector: false, min: 0 });
    expect(options.enable_support).toMatchObject({ type: "bool", vector: false });
    expect(options.wall_generator).toMatchObject({ type: "enum", vector: false, enum: ["classic", "arachne"] });
    expect(options.outer_wall_speed).toMatchObject({ type: "float", vector: true, min: 0 });
    expect(options.nozzle_temperature).toMatchObject({ type: "int", vector: true, min: 0, max: 350 });
  });

  it("unwraps a nested-brace vector-bool default to a real boolean, not a literal '{false' string", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.override_process_overhang_speed).toMatchObject({
      type: "bool",
      vector: true,
      default: false,
    });
  });

  it("coerces an int-literal bool default (ConfigOptionBool(0)/(1)) to a real boolean", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.precise_z_height).toMatchObject({ type: "bool", default: false });
    expect(options.exclude_object).toMatchObject({ type: "bool", default: true });
  });

  it("extracts enum values declared via enum_values.emplace_back(...)", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.brim_type).toMatchObject({ type: "enum", enum: ["auto_brim", "no_brim"] });
  });

  it("resolves an enum aliased from an earlier option via `def->enum_values = <alias>->enum_values`", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.bottom_surface_pattern).toMatchObject({
      type: "enum",
      enum: ["concentric", "zig-zag"],
    });
  });

  it("unwraps an L(\"...\") localization macro in a string default to its inner text", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.filament_vendor).toMatchObject({ type: "string", default: "(Undefined)" });
  });

  it("extracts label from def->label = L(\"...\")", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.layer_height.label).toBe("Layer height");
    expect(options.wall_generator.label).toBeUndefined();
  });

  it("extracts a single-line description from def->tooltip = L(\"...\")", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.layer_height.description).toBe(
      "Slicing height for each layer. Smaller layer height means more accurate and more printing time"
    );
  });

  it("concatenates a multi-line adjacent-string-literal tooltip into one description", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.nozzle_temperature.description).toBe(
      "Nozzle temperature for layers except the initial one. Value 0 means the filament does not support to print on this nozzle"
    );
    expect(options.outer_wall_speed.description).toBe(
      "Speed of outer wall which is outermost and visible. It's used to be slower than inner wall speed to get better quality."
    );
  });

  it("decodes C++ \\n escapes to real newlines, and joins adjacent literals with no separator (faithful to C++ concatenation)", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.enable_support.description).toBe(
      "This is particularly helpful in the below scenarios:\n" +
        "1. To avoid changes in shine when printing glossy filaments\n" +
        "2. To avoid printing at speeds which cause VFAs on the external walls"
    );
  });

  it("omits label/description for options that declare neither", async () => {
    const source = await readFile(PRINT_CONFIG_FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.wall_generator.label).toBeUndefined();
    expect(options.wall_generator.description).toBeUndefined();
  });
});

describe("parseOptionList", () => {
  it("resolves the indirect `fnName() { return <var>; }` pattern to the static vector's keys", async () => {
    const source = await readFile(PRESET_FIXTURE, "utf8");

    expect(parseOptionList(source, "print_options")).toEqual([
      "layer_height",
      "wall_loops",
      "enable_support",
      "wall_generator",
      "outer_wall_speed",
    ]);
  });

  it("strips commented-out keys and multi-line entries for filament_options", async () => {
    const source = await readFile(PRESET_FIXTURE, "utf8");

    const keys = parseOptionList(source, "filament_options");
    expect(keys).toEqual(["default_filament_colour", "filament_diameter", "nozzle_temperature", "filament_type"]);
    expect(keys).not.toContain("filament_colour");
  });

  it("returns an empty array for a function name that isn't present", async () => {
    const source = await readFile(PRESET_FIXTURE, "utf8");

    expect(parseOptionList(source, "sla_print_options")).toEqual([]);
  });
});
