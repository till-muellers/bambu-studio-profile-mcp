import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import {
  handleListFilaments,
  handleListParameters,
  handleListProfiles,
  handleListVendors,
} from "../src/tools/list.js";
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
    const result = await handleListProfiles(fixtureDeps(), { kind: "process" });
    expect(result.kind).toBe("process");
    expect(result.profiles.some((p) => p.name === "My Custom Draft" && p.source === "user")).toBe(true);
    expect(result.profiles.some((p) => p.name === "fdm_process_common" && p.source === "system" && p.vendor === "BBL")).toBe(
      true
    );
  });

  it("scopes to the given vendor", async () => {
    const result = await handleListProfiles(fixtureDeps(), { kind: "process", vendor: "BBL" });
    expect(result.profiles.every((p) => p.source !== "system" || p.vendor === "BBL")).toBe(true);
  });

  it("filters by search case-insensitively", async () => {
    const result = await handleListProfiles(fixtureDeps(), { kind: "process", search: "STANDARD" });
    expect(result.profiles.map((p) => p.name)).toEqual(["0.20mm Standard @BBL X1C"]);
  });

  it("lists filament profiles under the filament kind", async () => {
    const result = await handleListProfiles(fixtureDeps(), { kind: "filament", vendor: "BBL" });
    expect(result.kind).toBe("filament");
    expect(result.profiles.map((p) => p.name)).toContain("Generic PLA @BBL X1C");
  });

  it("returns only user rows for source 'user'", async () => {
    const result = await handleListProfiles(fixtureDeps(), { kind: "process", source: "user" });
    expect(result.profiles.length).toBeGreaterThan(0);
    expect(result.profiles.every((p) => p.source === "user")).toBe(true);
  });

  it("returns only system rows for source 'system'", async () => {
    const result = await handleListProfiles(fixtureDeps(), { kind: "process", source: "system" });
    expect(result.profiles.length).toBeGreaterThan(0);
    expect(result.profiles.every((p) => p.source === "system")).toBe(true);
  });

  it("returns both sources when source is omitted", async () => {
    const both = await handleListProfiles(fixtureDeps(), { kind: "process" });
    const users = await handleListProfiles(fixtureDeps(), { kind: "process", source: "user" });
    const systems = await handleListProfiles(fixtureDeps(), { kind: "process", source: "system" });
    expect(both.profiles.length).toBe(users.profiles.length + systems.profiles.length);
    expect(both.profiles.some((p) => p.source === "user")).toBe(true);
    expect(both.profiles.some((p) => p.source === "system")).toBe(true);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListProfiles(fixtureDeps(false), { kind: "process" })).rejects.toBeInstanceOf(
      ConfigMissingError
    );
  });
});

describe("handleListVendors", () => {
  it("returns sorted vendor ids with display names", async () => {
    const result = await handleListVendors(fixtureDeps());
    expect(result).toEqual({
      vendors: [
        { id: "BBL", name: "Bambulab" },
        { id: "OTHERCO", name: "OTHERCO" },
      ],
    });
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListVendors(fixtureDeps(false))).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("handleListParameters", () => {
  it("returns every schema entry for the given kind when search is omitted", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "process" });
    expect(result.kind).toBe("process");
    expect(result.parameters.map((p) => p.key)).toContain("layer_height");
    expect(result.parameters.map((p) => p.key)).toContain("notes");
  });

  it("includes enriched label/description alongside the raw schema fields", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "process" });
    const layerHeight = result.parameters.find((p) => p.key === "layer_height");
    expect(layerHeight).toMatchObject({
      key: "layer_height",
      type: "float",
      vector: false,
      min: 0.04,
      max: 1.0,
      default: 0.2,
      label: "Layer height",
      description: "Slicing height for each layer. Smaller layer height means more accurate and more printing time",
    });
  });

  it("matches search case-insensitively against the key", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "process", search: "LAYER_HEIGHT" });
    expect(result.parameters.map((p) => p.key)).toEqual(["layer_height"]);
  });

  it("matches search case-insensitively against the label", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "process", search: "outer wall" });
    expect(result.parameters.map((p) => p.key)).toEqual(["outer_wall_speed"]);
  });

  it("matches search case-insensitively against the description", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "filament", search: "does not support" });
    expect(result.parameters.map((p) => p.key)).toEqual(["nozzle_temperature"]);
  });

  it("returns no entries when search matches nothing", async () => {
    const result = await handleListParameters(fixtureDeps(), { kind: "process", search: "zzz_no_match" });
    expect(result.parameters).toEqual([]);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListParameters(fixtureDeps(false), { kind: "process" })).rejects.toBeInstanceOf(
      ConfigMissingError
    );
  });
});

describe("handleListFilaments", () => {
  it("returns distinct, sorted filament ids with display names across the user store and every vendor", async () => {
    const result = await handleListFilaments(fixtureDeps());
    expect(result).toEqual({
      filaments: [
        { id: "GFA00", name: "fdm_filament_common" },
        { id: "GFB99", name: "Generic PLA" },
        { id: "GFC00", name: "Other PLA" },
      ],
    });
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(handleListFilaments(fixtureDeps(false))).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("toToolError", () => {
  it("wraps an error message into an isError tool result", () => {
    const result = toToolError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
