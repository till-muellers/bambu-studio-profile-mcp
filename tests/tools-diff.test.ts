import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleDiff } from "../src/tools/diff.js";
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
  tmp = await mkdtemp(join(tmpdir(), "ppm-diff-"));
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

async function writeSource(name: string, body: Record<string, unknown>): Promise<string> {
  const path = join(outDir, `${name}.json`);
  await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
  return path;
}

async function writeInstalled(name: string, body: Record<string, unknown>): Promise<string> {
  const path = join(userStore, "user", "u1", "process", `${name}.json`);
  await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
  return path;
}

describe("handleDiff", () => {
  it("reports changed, only-in-source, and only-installed keys, skipping metadata", async () => {
    await writeSource("Tuned", {
      name: "Tuned",
      inherits: "base",
      from: "User",
      version: "1.0.0.0",
      print_settings_id: "Tuned",
      layer_height: "0.16",
      wall_loops: "3",
    });
    await writeInstalled("Tuned", {
      name: "Tuned",
      inherits: "base",
      from: "User",
      version: "2.0.0.0",
      print_settings_id: "Other",
      layer_height: "0.20",
      brim_type: "no_brim",
    });
    const result = await handleDiff(deps(), "process", { name: "Tuned", outputDir: outDir });
    expect(result.identical).toBe(false);
    expect(result.changed).toEqual([{ key: "layer_height", source: "0.16", installed: "0.20" }]);
    expect(result.onlyInSource).toEqual([{ key: "wall_loops", value: "3" }]);
    expect(result.onlyInstalled).toEqual([{ key: "brim_type", value: "no_brim" }]);
  });

  it("compares inherits and array values, and reports identical files", async () => {
    await writeSource("Rebased", {
      name: "Rebased",
      inherits: "base_a",
      nozzle_temperature: ["220", "nil"],
    });
    await writeInstalled("Rebased", {
      name: "Rebased",
      inherits: "base_b",
      nozzle_temperature: ["230", "nil"],
    });
    const drift = await handleDiff(deps(), "process", { name: "Rebased", outputDir: outDir });
    expect(drift.changed).toEqual([
      { key: "inherits", source: "base_a", installed: "base_b" },
      { key: "nozzle_temperature", source: ["220", "nil"], installed: ["230", "nil"] },
    ]);

    await writeInstalled("Rebased", {
      name: "Rebased",
      inherits: "base_a",
      from: "User",
      nozzle_temperature: ["220", "nil"],
    });
    const same = await handleDiff(deps(), "process", { name: "Rebased", outputDir: outDir });
    expect(same.identical).toBe(true);
    expect(same.changed).toEqual([]);
  });

  it("carries both mtimes and derives which side is newer", async () => {
    const sourcePath = await writeSource("Aged", { name: "Aged", inherits: "base", layer_height: "0.2" });
    const installedPath = await writeInstalled("Aged", { name: "Aged", inherits: "base", layer_height: "0.3" });
    const old = new Date("2026-01-01T00:00:00Z");
    await utimes(sourcePath, old, old);
    const result = await handleDiff(deps(), "process", { name: "Aged", outputDir: outDir });
    expect(result.source).toMatchObject({ path: sourcePath, modifiedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.installed.path).toBe(installedPath);
    expect(Date.parse(result.installed.modifiedAt)).toBeGreaterThan(Date.parse(result.source.modifiedAt));
    expect(result.newer).toBe("installed");
  });

  it("diffs a differently named local file via sourceName", async () => {
    await writeSource("draft-copy", { name: "draft-copy", inherits: "base", layer_height: "0.12" });
    await writeInstalled("Production", { name: "Production", inherits: "base", layer_height: "0.2" });
    const result = await handleDiff(deps(), "process", {
      name: "Production",
      outputDir: outDir,
      sourceName: "draft-copy",
    });
    expect(result.changed).toEqual([{ key: "layer_height", source: "0.12", installed: "0.2" }]);
  });

  it("distinguishes unparseable files from JSON that is not an object", async () => {
    await writeInstalled("Shaped", { name: "Shaped", inherits: "base" });
    await writeFile(join(outDir, "Shaped.json"), "[1, 2]\n", "utf8");
    await expect(handleDiff(deps(), "process", { name: "Shaped", outputDir: outDir })).rejects.toThrow(
      /Source profile .* does not contain a JSON object\./
    );

    await writeFile(join(outDir, "Shaped.json"), "not json\n", "utf8");
    await expect(handleDiff(deps(), "process", { name: "Shaped", outputDir: outDir })).rejects.toThrow(
      /Source profile .* is not valid JSON\./
    );

    await writeSource("Shaped", { name: "Shaped", inherits: "base" });
    await writeFile(join(userStore, "user", "u1", "process", "Shaped.json"), "\"scalar\"\n", "utf8");
    await expect(handleDiff(deps(), "process", { name: "Shaped", outputDir: outDir })).rejects.toThrow(
      /Installed preset .* does not contain a JSON object\./
    );
  });

  it("reports a source it cannot read as unparseable, having no separate message for it", async () => {
    await writeInstalled("Blocked", { name: "Blocked", inherits: "base" });
    await mkdir(join(outDir, "Blocked.json"));
    await expect(handleDiff(deps(), "process", { name: "Blocked", outputDir: outDir })).rejects.toThrow(
      /Source profile .* is not valid JSON\./
    );
  });

  it("fails on missing source, missing installed preset, and traversal names", async () => {
    await writeInstalled("Lonely", { name: "Lonely", inherits: "base" });
    await expect(handleDiff(deps(), "process", { name: "Lonely", outputDir: outDir })).rejects.toThrow(/not found/i);

    await writeSource("Ghost", { name: "Ghost", inherits: "base" });
    await expect(handleDiff(deps(), "process", { name: "Ghost", outputDir: outDir })).rejects.toThrow(
      /No preset installed/i
    );

    await expect(
      handleDiff(deps(), "process", { name: "../evil", outputDir: outDir })
    ).rejects.toThrow(/path|separator|plain filename/i);
  });
});
