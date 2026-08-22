import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError, SchemaValidationError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import { writeProfileFile } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleUpdate } from "../src/tools/update.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class FixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" };
  }
}

class UnconfiguredFixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return null;
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

function unconfiguredDeps(): ToolDeps {
  return { ...deps(), config: new UnconfiguredFixtureConfig() };
}

let outDir: string;
beforeEach(async () => {
  outDir = join(await mkdtemp(join(tmpdir(), "ppm-update-")), "out");
});
afterEach(async () => {
  await rm(join(outDir, ".."), { recursive: true, force: true });
});

async function seedProfile(name: string, body: Record<string, unknown>): Promise<string> {
  const { path } = await writeProfileFile(outDir, name, {
    name,
    inherits: "fdm_process_common",
    ...body,
  });
  return path;
}

describe("handleUpdate", () => {
  it("upserts a new key", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const result = await handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { wall_loops: "3" },
    });
    expect(result).toMatchObject({
      name: "Existing",
      kind: "process",
      set: ["wall_loops"],
      removed: [],
    });
    expect(result.overrides).toEqual({ layer_height: "0.2", wall_loops: "3" });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({
      name: "Existing",
      inherits: "fdm_process_common",
      layer_height: "0.2",
      wall_loops: "3",
    });
  });

  it("overwrites an existing key", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const result = await handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { layer_height: "0.16" },
    });
    expect(result.overrides).toEqual({ layer_height: "0.16" });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.layer_height).toBe("0.16");
  });

  it("removes an existing key", async () => {
    await seedProfile("Existing", { layer_height: "0.2", wall_loops: "3" });
    const result = await handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      remove: ["wall_loops"],
    });
    expect(result.removed).toEqual(["wall_loops"]);
    expect(result.overrides).toEqual({ layer_height: "0.2" });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({ name: "Existing", inherits: "fdm_process_common", layer_height: "0.2" });
  });

  it("rejects an unknown remove key and writes nothing", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const before = await readFile(join(outDir, "Existing.json"), "utf8");
    const promise = handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      remove: ["ghost_key"],
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    const violation = err.violations.find((v) => v.key === "ghost_key");
    expect(violation?.reason).toMatch(/not present/i);
    const after = await readFile(join(outDir, "Existing.json"), "utf8");
    expect(after).toBe(before);
  });

  it("rejects reserved keys in set and in remove, collecting both violations", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const promise = handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { name: "Sneaky" },
      remove: ["inherits"],
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    const keys = err.violations.map((v) => v.key).sort();
    expect(keys).toEqual(["inherits", "name"]);
    for (const v of err.violations) {
      expect(v.reason).toMatch(/reserved key/i);
    }
  });

  it("rejects a key present in both set and remove, and writes nothing", async () => {
    await seedProfile("Existing", { layer_height: "0.2", wall_loops: "2" });
    const before = await readFile(join(outDir, "Existing.json"), "utf8");
    const promise = handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { wall_loops: "3" },
      remove: ["wall_loops"],
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    const violation = err.violations.find((v) => v.key === "wall_loops");
    expect(violation?.reason).toMatch(/both set and remove/i);
    const after = await readFile(join(outDir, "Existing.json"), "utf8");
    expect(after).toBe(before);
  });

  it("confirms the reserved-key double-report exclusion still holds (reserved keys don't also report as 'not present')", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const promise = handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { name: "Sneaky" },
      remove: ["inherits"],
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    expect(err.violations.map((v) => v.key).sort()).toEqual(["inherits", "name"]);
    for (const v of err.violations) {
      expect(v.reason).toMatch(/reserved key/i);
    }
  });

  it("rejects unparseable JSON in the profile file with an error naming the path", async () => {
    await mkdir(outDir, { recursive: true });
    const path = join(outDir, "Broken.json");
    await writeFile(path, "{ not valid json", "utf8");
    await expect(
      handleUpdate(deps(), "process", {
        name: "Broken",
        outputDir: outDir,
        set: { layer_height: "0.2" },
      })
    ).rejects.toThrow(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects non-object JSON in the profile file with an error naming the path", async () => {
    await mkdir(outDir, { recursive: true });
    const path = join(outDir, "ArrayBody.json");
    await writeFile(path, "[1, 2, 3]", "utf8");
    await expect(
      handleUpdate(deps(), "process", {
        name: "ArrayBody",
        outputDir: outDir,
        set: { layer_height: "0.2" },
      })
    ).rejects.toThrow(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects an invalid set value and writes nothing", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const before = await readFile(join(outDir, "Existing.json"), "utf8");
    const promise = handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { layer_height: "5.0" },
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const after = await readFile(join(outDir, "Existing.json"), "utf8");
    expect(after).toBe(before);
  });

  it("rejects a missing file with an error naming write_profile", async () => {
    await expect(
      handleUpdate(deps(), "process", {
        name: "Ghost",
        outputDir: outDir,
        set: { layer_height: "0.2" },
      })
    ).rejects.toThrow(/write_profile/);
  });

  it("rejects when neither set nor remove is given", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    await expect(
      handleUpdate(deps(), "process", {
        name: "Existing",
        outputDir: outDir,
      })
    ).rejects.toThrow(/Nothing to do/);
  });

  it("throws ConfigMissingError when un-inited", async () => {
    await expect(
      handleUpdate(unconfiguredDeps(), "process", {
        name: "Existing",
        outputDir: outDir,
        set: { layer_height: "0.2" },
      })
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });

  it("preserves name and inherits through an update", async () => {
    await seedProfile("Existing", { layer_height: "0.2" });
    const result = await handleUpdate(deps(), "process", {
      name: "Existing",
      outputDir: outDir,
      set: { wall_loops: "3" },
    });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.name).toBe("Existing");
    expect(onDisk.inherits).toBe("fdm_process_common");
    expect(existsSync(outDir)).toBe(true);
  });
});
