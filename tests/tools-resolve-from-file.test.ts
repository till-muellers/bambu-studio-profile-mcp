import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleResolveFromFile } from "../src/tools/resolve-from-file.js";
import type { ServerConfig } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class TempConfig extends ConfigManager {
  constructor(private readonly cfg: ServerConfig) {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load(): Promise<ServerConfig | null> {
    return this.cfg;
  }
}

let tmp: string;
let outDir: string;
let userStore: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ppm-resolve-file-"));
  outDir = join(tmp, "out");
  await mkdir(outDir, { recursive: true });
  userStore = join(tmp, "userdata");
  await mkdir(join(userStore, "user", "u1", "process"), { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new TempConfig({ installDir: join(FIXTURES, "install"), userDataDir: userStore, userId: "u1" }),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

async function writeSource(fileName: string, body: Record<string, unknown>): Promise<string> {
  const path = join(outDir, `${fileName}.json`);
  await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
  return path;
}

describe("handleResolveFromFile", () => {
  it("merges the file's overrides on top of its resolved inherits chain", async () => {
    const path = await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
      brim_type: "no_brim",
    });

    const result = await handleResolveFromFile(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Tuned",
    });

    expect(result).toMatchObject({ vendor: "BBL", name: "Tuned", kind: "process", path });
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C", "Tuned"]);
    // Override wins over the chain value, inherited values survive, new keys are added.
    expect(result.settings.layer_height).toBe("0.16");
    expect(result.settings.wall_loops).toBe("3");
    expect(result.settings.sparse_infill_density).toBe("15%");
    expect(result.settings.outer_wall_speed).toEqual(["250", "500", "500"]);
    expect(result.settings.brim_type).toBe("no_brim");
  });

  it("merges a machine file's overrides on top of its resolved machine chain", async () => {
    await writeSource("X1C Wide", {
      name: "X1C Wide",
      inherits: "Bambu Lab X1 Carbon 0.4 nozzle",
      printable_height: "300",
    });

    const result = await handleResolveFromFile(deps(), "machine", {
      vendor: "BBL",
      outputDir: outDir,
      name: "X1C Wide",
    });

    expect(result.kind).toBe("machine");
    expect(result.chain).toEqual([
      "fdm_machine_common",
      "Bambu Lab X1 Carbon 0.4 nozzle",
      "X1C Wide",
    ]);
    expect(result.settings.printable_height).toBe("300");
    expect(result.settings.printer_extruder_variant).toEqual([
      "Direct Drive Standard",
      "Direct Drive High Flow",
      "Direct Drive Standard",
    ]);
  });

  it("ignores identity and synthesized metadata keys in the file", async () => {
    await writeSource("Installed Shape", {
      name: "Installed Shape",
      inherits: "fdm_process_common",
      from: "User",
      version: "9.9.9.9",
      print_settings_id: "Installed Shape",
      filament_settings_id: ["Installed Shape"],
      wall_loops: "4",
    });

    const result = await handleResolveFromFile(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Installed Shape",
    });

    expect(result.settings.version).toBe("2.7.0.8");
    expect(result.settings.from).toBeUndefined();
    expect(result.settings.print_settings_id).toBeUndefined();
    expect(result.settings.filament_settings_id).toBeUndefined();
    expect(result.settings.name).toBeUndefined();
    expect(result.settings.inherits).toBeUndefined();
    expect(result.settings.wall_loops).toBe("4");
  });

  it("reads a differently named local file via sourceName", async () => {
    const path = await writeSource("draft-copy", {
      name: "draft-copy",
      inherits: "fdm_process_common",
      wall_loops: "5",
    });

    const result = await handleResolveFromFile(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Production",
      sourceName: "draft-copy",
    });

    expect(result.path).toBe(path);
    expect(result.name).toBe("Production");
    expect(result.chain).toEqual(["fdm_process_common", "Production"]);
    expect(result.settings.wall_loops).toBe("5");
  });

  it("resolves a filament file against the filament store", async () => {
    await writeSource("Hot PLA", {
      name: "Hot PLA",
      inherits: "Generic PLA @BBL X1C",
      nozzle_temperature: ["230", "230"],
    });

    const result = await handleResolveFromFile(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Hot PLA",
    });

    expect(result.kind).toBe("filament");
    expect(result.chain.at(-1)).toBe("Hot PLA");
    expect(result.settings.nozzle_temperature).toEqual(["230", "230"]);
  });

  it("resolves the file's own nil columns against its inherits chain", async () => {
    await writeSource("Partial PLA", {
      name: "Partial PLA",
      inherits: "Generic PLA @BBL X1C",
      nozzle_temperature: ["230", "nil"],
    });

    const result = await handleResolveFromFile(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Partial PLA",
    });

    // The chain supplies one column only, so the second stays nil and is reported.
    expect(result.settings.nozzle_temperature).toEqual(["230", "nil"]);
    expect(result.nilUnresolved).toEqual({ nozzle_temperature: [1] });
  });

  it("fills a file's filament override nil columns from the named machine preset", async () => {
    await writeSource("Retract PLA", {
      name: "Retract PLA",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.5", "nil", "nil"],
    });

    const withMachine = await handleResolveFromFile(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Retract PLA",
      machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
    });
    expect(withMachine.settings.filament_retraction_length).toEqual(["1.5", "1.2", "0.8"]);
    expect(withMachine.nilResolved).toEqual({ filament_retraction_length: [1, 2] });

    const withoutMachine = await handleResolveFromFile(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Retract PLA",
    });
    expect(withoutMachine.settings.filament_retraction_length).toEqual(["1.5", "nil", "nil"]);
    expect(withoutMachine.nilUnresolved).toEqual({ filament_retraction_length: [1, 2] });
  });

  it("fails on a missing file, malformed JSON, and a non-object file", async () => {
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Ghost" })
    ).rejects.toThrow(/not found/i);

    await writeFile(join(outDir, "Broken.json"), "{ not json", "utf8");
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Broken" })
    ).rejects.toThrow(/not valid JSON/i);

    await writeFile(join(outDir, "Listy.json"), "[1, 2, 3]", "utf8");
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Listy" })
    ).rejects.toThrow(/JSON object/i);
  });

  it("projects settings down to the requested keys and reports the rest", async () => {
    await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });

    const result = await handleResolveFromFile(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Tuned",
      keys: ["layer_height", "no_such_key"],
    });

    expect(Object.keys(result.settings)).toEqual(["layer_height"]);
    expect(result.settings.layer_height).toBe("0.16");
    expect(result.missingKeys).toEqual(["no_such_key"]);
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C", "Tuned"]);
  });

  it("returns the unprojected result byte-for-byte when keys is omitted", async () => {
    await writeSource("Plain", { name: "Plain", inherits: "0.20mm Standard @BBL X1C", layer_height: "0.16" });
    const args = { vendor: "BBL", outputDir: outDir, name: "Plain" };

    const withoutKeys = await handleResolveFromFile(deps(), "process", args);
    const withUndefinedKeys = await handleResolveFromFile(deps(), "process", { ...args, keys: undefined });

    expect(JSON.stringify(withoutKeys)).toBe(JSON.stringify(withUndefinedKeys));
    expect(withoutKeys).not.toHaveProperty("missingKeys");
    expect(Object.keys(withoutKeys.settings).length).toBeGreaterThan(1);
  });

  it("fails on a missing, empty, or unresolvable inherits field", async () => {
    await writeSource("Rootless", { name: "Rootless", layer_height: "0.2" });
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Rootless" })
    ).rejects.toThrow(/'inherits'/);

    await writeSource("Blank", { name: "Blank", inherits: "", layer_height: "0.2" });
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Blank" })
    ).rejects.toThrow(/'inherits'/);

    await writeSource("Dangling", { name: "Dangling", inherits: "no_such_parent" });
    await expect(
      handleResolveFromFile(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Dangling" })
    ).rejects.toThrow(/not found/i);
  });
});
