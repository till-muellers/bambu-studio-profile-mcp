import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager, readAppVersion, readPresetFolder, resolveConfigDir, validateConfigPaths } from "../src/config.js";
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

  it("creates the parent directory when it does not exist yet", async () => {
    const path = join(dir, ".bambu-studio-profile-mcp", "config.json");
    const mgr = new ConfigManager(path);
    expect(await mgr.save(VALID)).toBe(path);
    expect(await mgr.load()).toEqual(VALID);
  });
});

describe("resolveConfigDir", () => {
  const cwd = join("C", "cwd-root");

  it("uses BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR verbatim when set", () => {
    const env = {
      BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR: join("C", "explicit-dir"),
      CLAUDE_PROJECT_DIR: join("C", "claude-project"),
    };
    expect(resolveConfigDir(env, cwd)).toBe(join("C", "explicit-dir"));
  });

  it("uses <CLAUDE_PROJECT_DIR>/.bambu-studio-profile-mcp when BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR is unset", () => {
    const env = { CLAUDE_PROJECT_DIR: join("C", "claude-project") };
    expect(resolveConfigDir(env, cwd)).toBe(join("C", "claude-project", ".bambu-studio-profile-mcp"));
  });

  it("falls back to <cwd>/.bambu-studio-profile-mcp when neither env var is set", () => {
    expect(resolveConfigDir({}, cwd)).toBe(join(cwd, ".bambu-studio-profile-mcp"));
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

describe("readAppVersion", () => {
  it("reads app.version from a conf carrying the MD5 trailer", async () => {
    expect(await readAppVersion(join(FIXTURES, "userdata"))).toBe("02.08.02.60");
  });

  it("returns undefined when the conf has no app.version", async () => {
    await writeFile(
      join(dir, "BambuStudio.conf"),
      '{"app":{"preset_folder":"x"}}\n# MD5 checksum DEADBEEF\n',
      "utf8"
    );
    expect(await readAppVersion(dir)).toBeUndefined();
  });

  it("returns undefined when the conf is absent", async () => {
    expect(await readAppVersion(dir)).toBeUndefined();
  });

  it("returns undefined when the conf is not parseable", async () => {
    await writeFile(join(dir, "BambuStudio.conf"), "{not json\n", "utf8");
    expect(await readAppVersion(dir)).toBeUndefined();
  });
});

describe("readPresetFolder", () => {
  it("still reads app.preset_folder", async () => {
    expect(await readPresetFolder(join(FIXTURES, "userdata"))).toBe("1234567890");
  });
});
