import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ProfileNotFoundError, SchemaValidationError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleWrite } from "../src/tools/write.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class FixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" };
  }
}

function deps(): ToolDeps {
  return {
    config: new FixtureConfig(),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

let outDir: string;
beforeEach(async () => {
  outDir = join(await mkdtemp(join(tmpdir(), "ppm-write-")), "out");
});
afterEach(async () => {
  await rm(join(outDir, ".."), { recursive: true, force: true });
});

describe("handleWrite", () => {
  it("creates a new profile file with inherits and only the given kvps", async () => {
    const result = await handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "Plan Test Preset",
      baseProfile: "0.20mm Standard @BBL X1C",
      kvps: { layer_height: "0.16", outer_wall_speed: ["150", "400", "400"] },
      outputDir: outDir,
    });
    expect(result).toMatchObject({
      vendor: "BBL",
      name: "Plan Test Preset",
      kind: "process",
      created: true,
      inherits: "0.20mm Standard @BBL X1C",
    });
    expect(result.path).toBe(join(outDir, "Plan Test Preset.json"));
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({
      name: "Plan Test Preset",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
      outer_wall_speed: ["150", "400", "400"],
    });
  });

  it("overwrites an existing file with created: false", async () => {
    const args = {
      vendor: "BBL",
      name: "Twice",
      baseProfile: "fdm_process_common",
      kvps: { layer_height: "0.3" },
      outputDir: outDir,
    };
    await handleWrite(deps(), "process", args);
    const second = await handleWrite(deps(), "process", args);
    expect(second.created).toBe(false);
  });

  it("collects ALL schema violations and writes nothing", async () => {
    const promise = handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "Broken Preset",
      baseProfile: "fdm_process_common",
      kvps: { layer_height: "5.0", bogus_key: "1" },
      outputDir: outDir,
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    expect(err.violations.map((v) => v.key).sort()).toEqual(["bogus_key", "layer_height"]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a missing baseProfile and writes nothing", async () => {
    await expect(
      handleWrite(deps(), "process", {
        vendor: "BBL",
        name: "Orphaned Preset",
        baseProfile: "ghost_base",
        kvps: { wall_loops: "3" },
        outputDir: outDir,
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a reserved 'inherits' key in kvps and writes nothing", async () => {
    const promise = handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "Sneaky Preset",
      baseProfile: "fdm_process_common",
      kvps: { inherits: "ghost", layer_height: "0.2" },
      outputDir: outDir,
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    const violation = err.violations.find((v) => v.key === "inherits");
    expect(violation?.reason).toMatch(/reserved key/i);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a reserved 'name' key in kvps and writes nothing", async () => {
    const promise = handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "Sneaky Preset 2",
      baseProfile: "fdm_process_common",
      kvps: { name: "x" },
      outputDir: outDir,
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    const violation = err.violations.find((v) => v.key === "name");
    expect(violation?.reason).toMatch(/reserved key/i);
    expect(existsSync(outDir)).toBe(false);
  });

  it("validates filament writes against the filament schema, per element", async () => {
    await expect(
      handleWrite(deps(), "filament", {
        vendor: "BBL",
        name: "Hot PLA",
        baseProfile: "Generic PLA @BBL X1C",
        kvps: { nozzle_temperature: ["230", "999"] },
        outputDir: outDir,
      })
    ).rejects.toBeInstanceOf(SchemaValidationError);

    const ok = await handleWrite(deps(), "filament", {
      vendor: "BBL",
      name: "Hot PLA",
      baseProfile: "Generic PLA @BBL X1C",
      kvps: { nozzle_temperature: ["230"] },
      outputDir: outDir,
    });
    expect(ok.kind).toBe("filament");
    expect(ok.created).toBe(true);
    expect(await readdir(outDir)).toEqual(["Hot PLA.json"]);
  });

  it("accepts \"nil\" elements on a nullable filament vector option", async () => {
    const ok = await handleWrite(deps(), "filament", {
      vendor: "BBL",
      name: "Partial Override PLA",
      baseProfile: "Generic PLA @BBL X1C",
      kvps: { filament_retraction_length: ["0.8", "nil"] },
      outputDir: outDir,
    });
    expect(ok.kind).toBe("filament");
    expect(ok.created).toBe(true);
  });
});
