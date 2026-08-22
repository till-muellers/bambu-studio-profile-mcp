import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleInitConfig } from "../src/tools/init-config.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ppm-init-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(detected: Awaited<ReturnType<ToolDeps["detectPaths"]>> = {}): ToolDeps {
  return {
    config: new ConfigManager(join(dir, "config.json")),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => detected,
  };
}

describe("handleInitConfig", () => {
  it("persists explicit valid paths and makes them available to load() immediately", async () => {
    const d = deps();
    const result = await handleInitConfig(d, {
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "1234567890",
    });
    expect(result.persistedTo).toBe(join(dir, "config.json"));
    expect(await d.config.load()).toEqual({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "1234567890",
    });
  });

  it("fills omitted paths from detection", async () => {
    const d = deps({ installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata") });
    const result = await handleInitConfig(d, { userId: "1234567890" });
    expect(result.installDir).toBe(join(FIXTURES, "install"));
    expect(result.userDataDir).toBe(join(FIXTURES, "userdata"));
  });

  it("fails naming the missing field when detection cannot fill it", async () => {
    const promise = handleInitConfig(deps({ installDir: join(FIXTURES, "install") }), { userId: "1234567890" });
    await expect(promise).rejects.toThrow(/userDataDir/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  it("rejects invalid paths with all problems listed and persists nothing", async () => {
    const promise = handleInitConfig(deps(), { installDir: dir, userDataDir: dir, userId: "nobody" });
    await expect(promise).rejects.toThrow(/resources/);
    await expect(promise).rejects.toThrow(/nobody/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  it("rejects a userId with no matching user/<id> directory", async () => {
    await expect(
      handleInitConfig(deps(), {
        installDir: join(FIXTURES, "install"),
        userDataDir: join(FIXTURES, "userdata"),
        userId: "99999",
      })
    ).rejects.toThrow(/99999/);
  });

  it("auto-detects userId from BambuStudio.conf when omitted", async () => {
    const d = deps();
    const result = await handleInitConfig(d, {
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
    });
    expect(result.userId).toBe("1234567890");
    expect(await d.config.load()).toEqual({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "1234567890",
    });
  });

  it("explicit userId wins over the conf-detected value", async () => {
    const result = await handleInitConfig(deps(), {
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "default",
    });
    expect(result.userId).toBe("default");
  });

  it("rejects when userId omitted and BambuStudio.conf is missing", async () => {
    const noConfDir = join(dir, "no-conf-userdata");
    await mkdir(join(noConfDir, "user"), { recursive: true });
    const promise = handleInitConfig(deps(), {
      installDir: join(FIXTURES, "install"),
      userDataDir: noConfDir,
    });
    await expect(promise).rejects.toThrow(/BambuStudio\.conf/);
    await expect(promise).rejects.toThrow(/userId/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  it("rejects when userId omitted and the conf has no app.preset_folder", async () => {
    const badConfDir = join(dir, "bad-conf-userdata");
    await mkdir(join(badConfDir, "user"), { recursive: true });
    await writeFile(join(badConfDir, "BambuStudio.conf"), JSON.stringify({ app: {} }, null, 2) + "\n", "utf8");
    const promise = handleInitConfig(deps(), {
      installDir: join(FIXTURES, "install"),
      userDataDir: badConfDir,
    });
    await expect(promise).rejects.toThrow(/BambuStudio\.conf/);
    await expect(promise).rejects.toThrow(/userId/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });
});
