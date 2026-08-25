import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleCompare } from "../src/tools/compare.js";
import type { ServerConfig } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MACHINE = "Bambu Lab X1 Carbon 0.4 nozzle";

class TempConfig extends ConfigManager {
  constructor(private readonly cfg: ServerConfig) {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load(): Promise<ServerConfig | null> {
    return this.cfg;
  }
}

let tmp: string;
let outDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ppm-compare-"));
  outDir = join(tmp, "out");
  await mkdir(outDir, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new TempConfig({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
      userId: "1234567890",
    }),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

async function writeSource(fileName: string, body: Record<string, unknown>): Promise<string> {
  const path = join(outDir, `${fileName}.json`);
  await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
  return path;
}

describe("handleCompare", () => {
  it("reports only genuine differences between two installed presets in resolved mode", async () => {
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      left: { preset: "0.20mm Standard @BBL X1C" },
      right: { preset: "My Custom Draft" },
    });
    expect(result.mode).toBe("resolved");
    expect(result.left).toEqual({ label: "0.20mm Standard @BBL X1C" });
    expect(result.right).toEqual({ label: "My Custom Draft" });
    expect(result.identical).toBe(false);
    expect(result.changed).toEqual([{ key: "layer_height", left: "0.2", right: "0.28" }]);
    expect(result.onlyLeft).toEqual([]);
    expect(result.onlyRight).toEqual([]);
    expect(result.note).toBeUndefined();
  });

  it("compares the endpoints' declared keys in raw mode", async () => {
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      mode: "raw",
      left: { preset: "0.20mm Standard @BBL X1C" },
      right: { preset: "My Custom Draft" },
    });
    expect(result.mode).toBe("raw");
    expect(result.changed).toEqual([
      { key: "inherits", left: "fdm_process_common", right: "0.20mm Standard @BBL X1C" },
    ]);
    expect(result.onlyLeft).toEqual([
      { key: "outer_wall_speed", value: ["250", "500", "500"] },
      { key: "wall_loops", value: "3" },
    ]);
    expect(result.onlyRight).toEqual([{ key: "layer_height", value: "0.28" }]);
  });

  it("compares a file endpoint against an installed preset", async () => {
    const path = await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      left: { outputDir: outDir, name: "Tuned" },
      right: { preset: "My Custom Draft" },
    });
    expect(result.left).toEqual({ label: "Tuned", path });
    expect(result.right).toEqual({ label: "My Custom Draft" });
    expect(result.changed).toEqual([{ key: "layer_height", left: "0.16", right: "0.28" }]);
  });

  it("compares an installed preset against a file endpoint", async () => {
    const path = await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      left: { preset: "My Custom Draft" },
      right: { outputDir: outDir, name: "Tuned" },
    });
    expect(result.left).toEqual({ label: "My Custom Draft" });
    expect(result.right).toEqual({ label: "Tuned", path });
    expect(result.changed).toEqual([{ key: "layer_height", left: "0.28", right: "0.16" }]);
  });

  it("compares two file endpoints", async () => {
    await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });
    await writeSource("Thicker", {
      name: "Thicker",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.24",
    });
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      left: { outputDir: outDir, name: "Tuned" },
      right: { outputDir: outDir, name: "Thicker" },
    });
    expect(result.changed).toEqual([{ key: "layer_height", left: "0.16", right: "0.24" }]);
  });

  it("reports identical endpoints as identical", async () => {
    const result = await handleCompare(deps(), {
      kind: "process",
      vendor: "BBL",
      left: { preset: "My Custom Draft" },
      right: { preset: "My Custom Draft" },
    });
    expect(result.identical).toBe(true);
    expect(result.changed).toEqual([]);
    expect(result.onlyLeft).toEqual([]);
    expect(result.onlyRight).toEqual([]);
  });

  it("compares machine presets", async () => {
    const result = await handleCompare(deps(), {
      kind: "machine",
      vendor: "BBL",
      mode: "raw",
      left: { preset: MACHINE },
      right: { preset: "fdm_machine_common" },
    });
    expect(result.identical).toBe(false);
    expect(result.changed.map((c) => c.key)).toContain("printer_extruder_variant");
  });

  it("names the left side when its endpoint is absent", async () => {
    await expect(
      handleCompare(deps(), {
        kind: "process",
        vendor: "BBL",
        left: { preset: "No Such Preset" },
        right: { preset: "My Custom Draft" },
      })
    ).rejects.toThrow(/left.*No Such Preset/s);
  });

  it("names the right side when its endpoint is absent", async () => {
    await expect(
      handleCompare(deps(), {
        kind: "process",
        vendor: "BBL",
        left: { preset: "My Custom Draft" },
        right: { outputDir: outDir, name: "Missing" },
      })
    ).rejects.toThrow(/right.*Missing/s);
  });

  it("notes that unresolved nil columns were compared verbatim", async () => {
    await writeSource("Nil Twin", {
      name: "Nil Twin",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.5", "nil", "nil"],
    });
    const result = await handleCompare(deps(), {
      kind: "filament",
      vendor: "BBL",
      left: { preset: "Nil Override PLA @BBL X1C" },
      right: { outputDir: outDir, name: "Nil Twin" },
    });
    expect(result.identical).toBe(true);
    expect(result.note).toBeDefined();
    expect(result.note).toContain("filament_retraction_length");
    expect(result.note).toContain("machineName");
  });

  it("resolves nil columns against the named machine preset", async () => {
    await writeSource("Explicit", {
      name: "Explicit",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.5", "1.2", "0.8"],
    });
    const withoutMachine = await handleCompare(deps(), {
      kind: "filament",
      vendor: "BBL",
      left: { preset: "Nil Override PLA @BBL X1C" },
      right: { outputDir: outDir, name: "Explicit" },
    });
    expect(withoutMachine.changed).toEqual([
      {
        key: "filament_retraction_length",
        left: ["1.5", "nil", "nil"],
        right: ["1.5", "1.2", "0.8"],
      },
    ]);
    expect(withoutMachine.note).toBeDefined();

    const withMachine = await handleCompare(deps(), {
      kind: "filament",
      vendor: "BBL",
      left: { preset: "Nil Override PLA @BBL X1C" },
      right: { outputDir: outDir, name: "Explicit" },
      machineName: MACHINE,
    });
    expect(withMachine.identical).toBe(true);
    expect(withMachine.note).toBeUndefined();
  });

  it("leaves raw mode untouched by machineName", async () => {
    await writeSource("Explicit", {
      name: "Explicit",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.5", "1.2", "0.8"],
    });
    const args = {
      kind: "filament",
      vendor: "BBL",
      mode: "raw",
      left: { preset: "Nil Override PLA @BBL X1C" },
      right: { outputDir: outDir, name: "Explicit" },
    } as const;
    const plain = await handleCompare(deps(), args);
    const withMachine = await handleCompare(deps(), { ...args, machineName: MACHINE });
    expect(plain.changed).toEqual([
      {
        key: "filament_retraction_length",
        left: ["1.5", "nil", "nil"],
        right: ["1.5", "1.2", "0.8"],
      },
    ]);
    expect(withMachine).toEqual(plain);
    expect(withMachine.note).toBeUndefined();
  });
});
