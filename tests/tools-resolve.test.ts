import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError, ProfileNotFoundError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import { toToolError, type ToolDeps } from "../src/tools/deps.js";
import { handleResolve } from "../src/tools/resolve.js";

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

describe("handleResolve", () => {
  it("resolves a system process profile through its full chain", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "0.20mm Standard @BBL X1C",
    });
    expect(result.kind).toBe("process");
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C"]);
    expect(result.settings.wall_loops).toBe("3");
    expect(result.settings.layer_height).toBe("0.2");
    expect(result.settings.outer_wall_speed).toEqual(["250", "500", "500"]);
  });

  it("resolves a user preset crossing into the system store", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "My Custom Draft",
    });
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C", "My Custom Draft"]);
    expect(result.settings.layer_height).toBe("0.28");
  });

  it("resolves filament profiles under the filament kind", async () => {
    const result = await handleResolve(fixtureDeps(), "filament", {
      vendor: "BBL",
      name: "Generic PLA @BBL X1C",
    });
    expect(result.kind).toBe("filament");
    expect(result.settings.nozzle_temperature).toEqual(["210"]);
  });

  it("propagates ProfileNotFoundError", async () => {
    await expect(
      handleResolve(fixtureDeps(), "process", { vendor: "BBL", name: "ghost" })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it("throws ConfigMissingError when unconfigured", async () => {
    await expect(
      handleResolve(fixtureDeps(false), "process", { vendor: "BBL", name: "anything" })
    ).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("toToolError", () => {
  it("wraps an error message into an isError tool result", () => {
    const result = toToolError(new ProfileNotFoundError("process", "ghost"));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("ghost");
  });
});
