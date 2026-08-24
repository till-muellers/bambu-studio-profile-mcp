import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError, ProfileNotFoundError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import { toToolError, type ToolDeps } from "../src/tools/deps.js";
import { handleResolve } from "../src/tools/resolve.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** ConfigManager whose config.json path points at a pre-written fixture config. */
class FixtureConfig extends ConfigManager {
  constructor(private readonly present: boolean) {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return this.present
      ? { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" }
      : null;
  }
}

function fixtureDeps(configured = true): ToolDeps {
  return {
    config: new FixtureConfig(configured),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

describe("handleResolve", () => {
  it("resolves a system process profile through its full chain", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "0.20mm Standard @BBL X1C",
    });
    expect(result.kind).toBe("process");
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C"]);
    expect(result.settings.wall_loops).toBe("3");
    expect(result.settings.layer_height).toBe("0.2");
    expect(result.settings.outer_wall_speed).toEqual(["250", "500", "500"]);
  });

  it("resolves a user preset crossing into the system store", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "My Custom Draft",
    });
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C", "My Custom Draft"]);
    expect(result.settings.layer_height).toBe("0.28");
  });

  it("resolves filament profiles under the filament kind", async () => {
    const result = await handleResolve(fixtureDeps(), "filament", {
      vendor: "BBL",
      name: "Generic PLA @BBL X1C",
    });
    expect(result.kind).toBe("filament");
    expect(result.settings.nozzle_temperature).toEqual(["210"]);
  });

  it("projects settings down to the requested keys", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "0.20mm Standard @BBL X1C",
      keys: ["layer_height", "wall_loops"],
    });
    expect(Object.keys(result.settings).sort()).toEqual(["layer_height", "wall_loops"]);
    expect(result.settings.layer_height).toBe("0.2");
    expect(result.missingKeys).toEqual([]);
    // Projection happens after resolution: the chain is untouched.
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C"]);
  });

  it("resolves machine profiles under the machine kind", async () => {
    const result = await handleResolve(fixtureDeps(), "machine", {
      vendor: "BBL",
      name: "Bambu Lab X1 Carbon 0.4 nozzle",
    });
    expect(result.kind).toBe("machine");
    expect(result.chain).toEqual(["fdm_machine_common", "Bambu Lab X1 Carbon 0.4 nozzle"]);
    expect(result.settings.printer_extruder_variant).toEqual([
      "Direct Drive Standard",
      "Direct Drive High Flow",
      "Direct Drive Standard",
    ]);
    expect(result.settings.retraction_length).toEqual(["0.8", "1.2", "0.8"]);
    expect(result.settings.gcode_flavor).toBe("marlin");
    expect(result.settings.printable_height).toBe("256");
  });

  it("projects the machine column count down to printer_extruder_variant", async () => {
    const result = await handleResolve(fixtureDeps(), "machine", {
      vendor: "BBL",
      name: "Bambu Lab X1 Carbon 0.4 nozzle",
      keys: ["printer_extruder_variant"],
    });
    expect(Object.keys(result.settings)).toEqual(["printer_extruder_variant"]);
    expect((result.settings.printer_extruder_variant as string[]).length).toBe(3);
  });

  it("reports requested keys the resolved settings lack", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "0.20mm Standard @BBL X1C",
      keys: ["layer_height", "no_such_key"],
    });
    expect(Object.keys(result.settings)).toEqual(["layer_height"]);
    expect(result.missingKeys).toEqual(["no_such_key"]);
  });

  it("returns the unprojected result byte-for-byte when keys is omitted", async () => {
    const args = { vendor: "BBL", name: "0.20mm Standard @BBL X1C" };
    const withoutKeys = await handleResolve(fixtureDeps(), "process", args);
    const withEmptyProjection = await handleResolve(fixtureDeps(), "process", { ...args, keys: undefined });
    expect(JSON.stringify(withoutKeys)).toBe(JSON.stringify(withEmptyProjection));
    expect(withoutKeys).not.toHaveProperty("missingKeys");
    expect(Object.keys(withoutKeys.settings).length).toBeGreaterThan(2);
  });

  it("fills a filament override's nil columns from the named machine preset", async () => {
    const result = await handleResolve(fixtureDeps(), "filament", {
      vendor: "BBL",
      name: "Nil Override PLA @BBL X1C",
      machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
    });
    expect(result.settings.filament_retraction_length).toEqual(["1.5", "1.2", "0.8"]);
    expect(result.nilResolved).toEqual({ filament_retraction_length: [1, 2] });
    expect(result).not.toHaveProperty("nilUnresolved");
  });

  it("keeps a filament override's nil columns when no machine preset is named", async () => {
    const result = await handleResolve(fixtureDeps(), "filament", {
      vendor: "BBL",
      name: "Nil Override PLA @BBL X1C",
    });
    expect(result.settings.filament_retraction_length).toEqual(["1.5", "nil", "nil"]);
    expect(result.nilUnresolved).toEqual({ filament_retraction_length: [1, 2] });
    expect(result).not.toHaveProperty("nilResolved");
  });

  it("projects the nil report down to the requested keys", async () => {
    const result = await handleResolve(fixtureDeps(), "filament", {
      vendor: "BBL",
      name: "Nil Override PLA @BBL X1C",
      keys: ["nozzle_temperature"],
    });
    expect(Object.keys(result.settings)).toEqual(["nozzle_temperature"]);
    expect(result).not.toHaveProperty("nilUnresolved");
  });

  it("propagates ProfileNotFoundError for an unknown machine preset", async () => {
    await expect(
      handleResolve(fixtureDeps(), "filament", {
        vendor: "BBL",
        name: "Nil Override PLA @BBL X1C",
        machineName: "No Such Printer",
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("propagates ProfileNotFoundError", async () => {
    await expect(
      handleResolve(fixtureDeps(), "process", { vendor: "BBL", name: "ghost" })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(
      handleResolve(fixtureDeps(false), "process", { vendor: "BBL", name: "anything" })
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("toToolError", () => {
  it("wraps an error message into an isError tool result", () => {
    const result = toToolError(new ProfileNotFoundError("process", "ghost"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("ghost");
  });
});
