import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VendorNotFoundError } from "../src/errors.js";
import { FsProfileStore, listFilaments, listProfiles, listVendors, writeProfileFile } from "../src/profile-store.js";
import type { ServerConfig } from "../src/types.js";

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

  it("finds a machine profile under the machine kind", async () => {
    const hit = await store().findProfile("machine", "BBL", "Bambu Lab X1 Carbon 0.4 nozzle");
    expect(hit?.source).toBe("system");
    expect(hit?.profile.inherits).toBe("fdm_machine_common");
    expect(hit?.path).toContain(join("BBL", "machine"));
  });

  it("prefers a user machine preset over the system store", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "bsp-machine-user-"));
    try {
      const machineDir = join(userDataDir, "user", "1234567890", "machine");
      await mkdir(machineDir, { recursive: true });
      await writeFile(
        join(machineDir, "mine.json"),
        JSON.stringify({ name: "Bambu Lab X1 Carbon 0.4 nozzle", printable_height: "999" }),
        "utf8"
      );
      const hit = await new FsProfileStore({
        installDir: join(FIXTURES, "install"),
        userDataDir,
        userId: "1234567890",
      }).findProfile("machine", "BBL", "Bambu Lab X1 Carbon 0.4 nozzle");
      expect(hit?.source).toBe("user");
      expect(hit?.profile.printable_height).toBe("999");
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
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

function cfg(userId = "1234567890"): ServerConfig {
  return {
    installDir: join(FIXTURES, "install"),
    userDataDir: join(FIXTURES, "userdata"),
    userId,
  };
}

describe("listProfiles", () => {
  it("lists user and system entries across all vendors when vendor is omitted", async () => {
    const result = await listProfiles(cfg(), "process");
    const user = result.filter((p) => p.source === "user");
    expect(user).toEqual([{ name: "My Custom Draft", source: "user", inherits: "0.20mm Standard @BBL X1C" }]);

    const system = result.filter((p) => p.source === "system");
    expect(system.every((p) => p.vendor === "BBL")).toBe(true);
    expect(system.map((p) => p.name)).toContain("0.20mm Standard @BBL X1C");
    expect(system.map((p) => p.name)).toContain("fdm_process_common");
  });

  it("scopes system entries to the given vendor", async () => {
    const result = await listProfiles(cfg(), "process", "BBL");
    expect(result.every((p) => p.source !== "system" || p.vendor === "BBL")).toBe(true);
    expect(result.some((p) => p.name === "fdm_process_common")).toBe(true);
  });

  it("rejects an explicit unknown vendor with VendorNotFoundError", async () => {
    await expect(listProfiles(cfg(), "process", "Acme")).rejects.toBeInstanceOf(VendorNotFoundError);
  });

  it("never throws for unknown/missing directories when vendor is omitted", async () => {
    const result = await listProfiles(
      { installDir: join(FIXTURES, "does-not-exist"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" },
      "process"
    );
    expect(result.filter((p) => p.source === "system")).toEqual([]);
  });

  it("lists filament profiles", async () => {
    const result = await listProfiles(cfg(), "filament", "BBL");
    expect(result.map((p) => p.name)).toContain("Generic PLA @BBL X1C");
    expect(result.map((p) => p.name)).toContain("fdm_filament_common");
  });
});

describe("listVendors", () => {
  it("returns sorted vendor ids with display names from <vendor>.json", async () => {
    const result = await listVendors(cfg());
    expect(result).toEqual([
      { id: "BBL", name: "Bambulab" },
      { id: "OTHERCO", name: "OTHERCO" },
    ]);
  });
});

describe("listFilaments", () => {
  it("collects distinct, sorted filament ids with display names across the user store and every vendor", async () => {
    const result = await listFilaments(cfg());
    expect(result).toEqual([
      { id: "GFA00", name: "fdm_filament_common" },
      { id: "GFB99", name: "Generic PLA" },
      { id: "GFC00", name: "Other PLA" },
    ]);
  });

  it("never throws for a missing installDir", async () => {
    const result = await listFilaments({
      installDir: join(FIXTURES, "does-not-exist"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "1234567890",
    });
    // Only the user store is reachable; GFA00's root carrier (fdm_filament_common) lives under
    // installDir, so the shortest surviving user-side carrier ("My Custom Filament") wins.
    expect(result).toContainEqual({ id: "GFA00", name: "My Custom Filament" });
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
