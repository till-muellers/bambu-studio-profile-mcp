import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleRemove } from "../src/tools/import.js";
import type { ServerConfig } from "../src/types.js";
import { formatInfoSidecar } from "../src/user-presets.js";

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
let processDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ppm-remove-"));
  processDir = join(tmp, "user", "u1", "process");
  await mkdir(processDir, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new TempConfig({ installDir: join(FIXTURES, "install"), userDataDir: tmp, userId: "u1" }),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

async function seed(name: string, body: Record<string, unknown>, info?: string): Promise<void> {
  await writeFile(join(processDir, `${name}.json`), JSON.stringify(body, null, 4), "utf8");
  if (info !== undefined) await writeFile(join(processDir, `${name}.info`), info, "utf8");
}

describe("handleRemove", () => {
  it("removes the json+info pair of a user preset without a cloud record", async () => {
    await seed("Local Draft", { name: "Local Draft", from: "User" }, formatInfoSidecar(1784668006));
    const result = await handleRemove(deps(), "process", { name: "Local Draft" });
    expect(result.cloudRecord).toBe(false);
    expect(result.removedInfo).toBe(join(processDir, "Local Draft.info"));
    expect(result.note).toContain("restart");
    expect(existsSync(join(processDir, "Local Draft.json"))).toBe(false);
    expect(existsSync(join(processDir, "Local Draft.info"))).toBe(false);
  });

  it("flags cloudRecord and warns when setting_id is populated", async () => {
    const info =
      "sync_info = \r\nuser_id = u1\r\nsetting_id = PPUS123\r\nbase_id = GP155\r\nupdated_time = 1\r\n";
    await seed("Synced Draft", { name: "Synced Draft", from: "User" }, info);
    const result = await handleRemove(deps(), "process", { name: "Synced Draft" });
    expect(result.cloudRecord).toBe(true);
    expect(result.note).toMatch(/sync/i);
    expect(existsSync(join(processDir, "Synced Draft.json"))).toBe(false);
  });

  it("removes a preset without a sidecar, reporting removedInfo null", async () => {
    await seed("Bare Draft", { name: "Bare Draft", from: "User" });
    const result = await handleRemove(deps(), "process", { name: "Bare Draft" });
    expect(result.removedInfo).toBeNull();
    expect(existsSync(join(processDir, "Bare Draft.json"))).toBe(false);
  });

  it("refuses when from is not User", async () => {
    await seed("Foreign", { name: "Foreign", from: "system" });
    await expect(handleRemove(deps(), "process", { name: "Foreign" })).rejects.toThrow(/from/);
    expect(existsSync(join(processDir, "Foreign.json"))).toBe(true);
  });

  it("refuses an unparseable preset json", async () => {
    await writeFile(join(processDir, "Murky.json"), "{ not json", "utf8");
    await expect(handleRemove(deps(), "process", { name: "Murky" })).rejects.toThrow(/verify/);
    expect(existsSync(join(processDir, "Murky.json"))).toBe(true);
  });

  it("refuses a preset json that parses to something other than an object", async () => {
    await writeFile(join(processDir, "Listy.json"), "[1, 2, 3]", "utf8");
    await expect(handleRemove(deps(), "process", { name: "Listy" })).rejects.toThrow(
      /cannot verify it is a user preset \(JSON is not an object\)\./
    );
    expect(existsSync(join(processDir, "Listy.json"))).toBe(true);
  });

  it("errors on a stray sidecar without its json", async () => {
    await writeFile(join(processDir, "Stray.info"), formatInfoSidecar(1), "utf8");
    await expect(handleRemove(deps(), "process", { name: "Stray" })).rejects.toThrow(/Stray\.info/);
    expect(existsSync(join(processDir, "Stray.info"))).toBe(true);
  });

  it("errors when the preset is not found at all", async () => {
    await expect(handleRemove(deps(), "process", { name: "Ghost" })).rejects.toThrow(/not found/);
  });

  it("rejects a traversal name and deletes nothing outside the kind dir", async () => {
    const sentinel = join(tmp, "user", "u1", "sentinel.json");
    await writeFile(sentinel, JSON.stringify({ name: "sentinel", from: "User" }), "utf8");
    await expect(handleRemove(deps(), "process", { name: "../sentinel" })).rejects.toThrow(
      /path|separator|plain filename/i
    );
    expect(existsSync(sentinel)).toBe(true);
  });
});
