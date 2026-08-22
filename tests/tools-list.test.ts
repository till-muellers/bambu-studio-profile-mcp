import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import { handleListProfiles, handleListVendors } from "../src/tools/list.js";
import { toToolError, type ToolDeps } from "../src/tools/deps.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** ConfigManager whose config.json path points at a pre-written fixture config. */
class FixtureConfig extends ConfigManager {
  constructor(private readonly present: boolean) {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return this.present
      ? { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" }
      : null;
  }
}

function fixtureDeps(configured = true): ToolDeps {
  return {
    config: new FixtureConfig(configured),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

describe("handleListProfiles", () => {
  it("lists every vendor's profiles when vendor is omitted", async () => {
    const result = await handleListProfiles(fixtureDeps(), "process", {});
    expect(result.kind).toBe("process");
    expect(result.profiles.some((p) => p.name === "My Custom Draft" && p.source === "user")).toBe(true);
    expect(result.profiles.some((p) => p.name === "fdm_process_common" && p.source === "system" && p.vendor === "BBL")).toBe(
      true
    );
  });

  it("scopes to the given vendor", async () => {
    const result = await handleListProfiles(fixtureDeps(), "process", { vendor: "BBL" });
    expect(result.profiles.every((p) => p.source !== "system" || p.vendor === "BBL")).toBe(true);
  });

  it("filters by nameContains case-insensitively", async () => {
    const result = await handleListProfiles(fixtureDeps(), "process", { nameContains: "STANDARD" });
    expect(result.profiles.map((p) => p.name)).toEqual(["0.20mm Standard @BBL X1C"]);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListProfiles(fixtureDeps(false), "process", {})).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("handleListVendors", () => {
  it("returns vendor names with per-kind profile counts", async () => {
    const result = await handleListVendors(fixtureDeps());
    expect(result.vendors).toEqual([{ name: "BBL", processCount: 5, filamentCount: 2 }]);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListVendors(fixtureDeps(false))).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("toToolError", () => {
  it("wraps an error message into an isError tool result", () => {
    const result = toToolError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
