import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager, validateConfigPaths } from "../src/config.js";
import { ConfigMissingError } from "../src/errors.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const VALID = {
  installDir: join(FIXTURES, "install"),
  userDataDir: join(FIXTURES, "userdata"),
  userId: "1234567890",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ppm-config-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ConfigManager.load", () => {
  it("returns the persisted config when config.json exists", async () => {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify(VALID));
    expect(await new ConfigManager(path).load()).toEqual(VALID);
  });

  it("returns null when config.json is absent", async () => {
    expect(await new ConfigManager(join(dir, "config.json")).load()).toBeNull();
  });

  it("returns null when config.json is missing a field", async () => {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ installDir: "x", userDataDir: "y" }));
    expect(await new ConfigManager(path).load()).toBeNull();
  });
});

describe("ConfigManager.require", () => {
  it("throws ConfigMissingError naming init_config when unconfigured", async () => {
    const mgr = new ConfigManager(join(dir, "config.json"));
    await expect(mgr.require()).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("ConfigManager.save", () => {
  it("persists config.json and load() reads it back", async () => {
    const path = join(dir, "config.json");
    const mgr = new ConfigManager(path);
    expect(await mgr.save(VALID)).toBe(path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(VALID);
    expect(await mgr.load()).toEqual(VALID);
  });
});

describe("validateConfigPaths", () => {
  it("accepts the fixture layout", async () => {
    expect(await validateConfigPaths(VALID)).toEqual([]);
  });

  it("reports bad installDir, bad userDataDir/userId — all collected", async () => {
    const problems = await validateConfigPaths({ installDir: dir, userDataDir: dir, userId: "nobody" });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("resources");
    expect(problems[1]).toContain("nobody");
  });

  it("reports a wrong userId even when userDataDir is right", async () => {
    const problems = await validateConfigPaths({ ...VALID, userId: "99999" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("99999");
  });
});
