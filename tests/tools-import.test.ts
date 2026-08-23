import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { SchemaValidationError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleImport } from "../src/tools/import.js";
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
  tmp = await mkdtemp(join(tmpdir(), "ppm-import-"));
  outDir = join(tmp, "out");
  await mkdir(outDir, { recursive: true });
  userStore = join(tmp, "userdata");
  await mkdir(join(userStore, "user", "u1", "process"), { recursive: true });
  await mkdir(join(userStore, "user", "u1", "filament"), { recursive: true });
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

async function writeSource(name: string, body: Record<string, unknown>): Promise<void> {
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(body, null, 4) + "\n", "utf8");
}

const PROCESS_ARGS = { vendor: "BBL", outputDir: "", name: "Imported Draft", overwrite: false };

describe("handleImport", () => {
  it("installs a process preset with synthesized metadata and sidecar", async () => {
    await writeSource("Imported Draft", {
      name: "Imported Draft",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });
    const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
    expect(result).toMatchObject({ kind: "process", name: "Imported Draft", overwritten: false });
    expect(result.note).toContain("restart");

    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({
      name: "Imported Draft",
      inherits: "0.20mm Standard @BBL X1C",
      from: "User",
      version: "2.7.0.8",
      print_settings_id: "Imported Draft",
      layer_height: "0.16",
    });

    const info = await readFile(result.infoPath, "utf8");
    expect(info).toMatch(
      /^sync_info = \r\nuser_id = \r\nsetting_id = \r\nbase_id = \r\nupdated_time = \d+\r\n$/
    );
  });

  it("omits version and uses the filament settings-id shape when the chain has no version", async () => {
    await writeSource("Hot PLA", {
      name: "Hot PLA",
      inherits: "Generic PLA @BBL X1C",
      nozzle_temperature: ["230"],
    });
    const result = await handleImport(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Hot PLA",
    });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.filament_settings_id).toEqual(["Hot PLA"]);
    expect(onDisk).not.toHaveProperty("version");
    expect(onDisk).not.toHaveProperty("print_settings_id");
  });

  it("ignores and regenerates Studio metadata keys in the source", async () => {
    await writeSource("Repo Preset", {
      name: "Repo Preset",
      inherits: "0.20mm Standard @BBL X1C",
      from: "system",
      version: "9.9.9.9",
      print_settings_id: "Stale Id",
      layer_height: "0.16",
    });
    const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir, name: "Repo Preset" });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.from).toBe("User");
    expect(onDisk.version).toBe("2.7.0.8");
    expect(onDisk.print_settings_id).toBe("Repo Preset");
    expect(onDisk.layer_height).toBe("0.16");
    expect(result.note).toMatch(/regenerated/);
    expect(result.note).toContain("from");
    expect(result.note).toContain("version");
    expect(result.note).toContain("print_settings_id");
  });

  it("regenerates a stale filament_settings_id and keeps the note silent without metadata", async () => {
    await writeSource("Fresh PLA", {
      name: "Fresh PLA",
      inherits: "Generic PLA @BBL X1C",
      filament_settings_id: ["Old Name"],
      nozzle_temperature: ["230"],
    });
    const result = await handleImport(deps(), "filament", { vendor: "BBL", outputDir: outDir, name: "Fresh PLA" });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.filament_settings_id).toEqual(["Fresh PLA"]);
    expect(result.note).toMatch(/regenerated/);

    await writeSource("Plain PLA", {
      name: "Plain PLA",
      inherits: "Generic PLA @BBL X1C",
      nozzle_temperature: ["230"],
    });
    const plain = await handleImport(deps(), "filament", { vendor: "BBL", outputDir: outDir, name: "Plain PLA" });
    expect(plain.note).not.toMatch(/regenerated/);
  });

  it("rejects invalid source kvps and writes nothing", async () => {
    await writeSource("Broken", { name: "Broken", inherits: "fdm_process_common", bogus_key: "1" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Broken" })
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(await readdir(join(userStore, "user", "u1", "process"))).toEqual([]);
  });

  it("fails when the source file is missing, naming write_profile", async () => {
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Ghost" })
    ).rejects.toThrow(/write_profile/);
  });

  it("fails on an unresolvable inherits target", async () => {
    await writeSource("Orphaned", { name: "Orphaned", inherits: "does_not_exist", layer_height: "0.2" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Orphaned" })
    ).rejects.toThrow(/does_not_exist/);
    expect(await readdir(join(userStore, "user", "u1", "process"))).toEqual([]);
  });

  it("refuses an existing target without overwrite, replaces it with overwrite", async () => {
    await writeSource("Twice", { name: "Twice", inherits: "fdm_process_common", layer_height: "0.2" });
    const args = { vendor: "BBL", outputDir: outDir, name: "Twice" };
    await handleImport(deps(), "process", args);
    await expect(handleImport(deps(), "process", args)).rejects.toThrow(/overwrite/);

    await writeSource("Twice", { name: "Twice", inherits: "fdm_process_common", layer_height: "0.3" });
    const second = await handleImport(deps(), "process", { ...args, overwrite: true });
    expect(second.overwritten).toBe(true);
    expect(JSON.parse(await readFile(second.path, "utf8")).layer_height).toBe("0.3");
  });

  it("refuses to overwrite a target whose from is not User, even with the flag", async () => {
    await writeSource("Sacred", { name: "Sacred", inherits: "fdm_process_common", layer_height: "0.2" });
    const target = join(userStore, "user", "u1", "process", "Sacred.json");
    await writeFile(target, JSON.stringify({ name: "Sacred", from: "system" }), "utf8");
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Sacred", overwrite: true })
    ).rejects.toThrow(/from/);
    expect(JSON.parse(await readFile(target, "utf8")).from).toBe("system");
  });

  it("refuses to overwrite an unparseable target, even with the flag", async () => {
    await writeSource("Murky", { name: "Murky", inherits: "fdm_process_common", layer_height: "0.2" });
    const target = join(userStore, "user", "u1", "process", "Murky.json");
    await writeFile(target, "{ not json", "utf8");
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Murky", overwrite: true })
    ).rejects.toThrow(/verify/);
    expect(await readFile(target, "utf8")).toBe("{ not json");
  });

  it("fails when the source has no inherits field", async () => {
    await writeSource("Rootless", { name: "Rootless", layer_height: "0.2" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Rootless" })
    ).rejects.toThrow(/inherits/);
  });

  it("rejects a traversal name and writes nothing outside the store", async () => {
    await writeFile(
      join(tmp, "evil.json"),
      JSON.stringify({ name: "evil", inherits: "fdm_process_common", layer_height: "0.2" }, null, 4),
      "utf8"
    );
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "../evil" })
    ).rejects.toThrow(/path|separator|plain filename/i);
    expect(existsSync(join(userStore, "evil.json"))).toBe(false);
  });
});
