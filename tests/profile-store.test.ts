import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VendorNotFoundError } from "../src/errors.js";
import { FsProfileStore, writeProfileFile } from "../src/profile-store.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function store(userId = "1234567890"): FsProfileStore {
  return new FsProfileStore({
    installDir: join(FIXTURES, "install"),
    userDataDir: join(FIXTURES, "userdata"),
    userId,
  });
}

describe("FsProfileStore.findProfile", () => {
  it("finds a system process profile by its name field", async () => {
    const hit = await store().findProfile("process", "BBL", "0.20mm Standard @BBL X1C");
    expect(hit?.source).toBe("system");
    expect(hit?.profile.inherits).toBe("fdm_process_common");
  });

  it("finds a user preset before the system store", async () => {
    const hit = await store().findProfile("process", "BBL", "My Custom Draft");
    expect(hit?.source).toBe("user");
    expect(hit?.profile.layer_height).toBe("0.28");
  });

  it("does not see presets from other userId directories", async () => {
    const hit = await store("default").findProfile("process", "BBL", "My Custom Draft");
    expect(hit).toBeNull();
  });

  it("still finds system profiles when the configured userId dir does not exist", async () => {
    const hit = await store("99999").findProfile("process", "BBL", "fdm_process_common");
    expect(hit?.source).toBe("system");
  });

  it("finds a filament profile under the filament kind", async () => {
    const hit = await store().findProfile("filament", "BBL", "Generic PLA @BBL X1C");
    expect(hit?.source).toBe("system");
  });

  it("returns null for an unknown profile in a known vendor", async () => {
    expect(await store().findProfile("process", "BBL", "nope")).toBeNull();
  });

  it("throws VendorNotFoundError for an unknown vendor", async () => {
    await expect(store().findProfile("process", "Acme", "anything")).rejects.toBeInstanceOf(
      VendorNotFoundError
    );
  });
});

describe("writeProfileFile", () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = join(await mkdtemp(join(tmpdir(), "ppm-out-")), "nested", "profiles");
  });
  afterEach(async () => {
    await rm(join(outDir, "..", ".."), { recursive: true, force: true });
  });

  it("creates the directory and file, reporting created: true", async () => {
    const result = await writeProfileFile(outDir, "Fresh Preset", {
      name: "Fresh Preset",
      inherits: "fdm_process_common",
      wall_loops: "4",
    });
    expect(result.created).toBe(true);
    expect(result.path).toBe(join(outDir, "Fresh Preset.json"));
    expect(JSON.parse(await readFile(result.path, "utf8")).wall_loops).toBe("4");
  });

  it("overwrites an existing file, reporting created: false", async () => {
    await writeProfileFile(outDir, "Twice", { name: "Twice", layer_height: "0.2" });
    const second = await writeProfileFile(outDir, "Twice", { name: "Twice", layer_height: "0.3" });
    expect(second.created).toBe(false);
    expect(JSON.parse(await readFile(second.path, "utf8")).layer_height).toBe("0.3");
    expect(existsSync(second.path)).toBe(true);
  });
});
