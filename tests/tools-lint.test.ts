import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleLint } from "../src/tools/lint.js";
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
let userStore: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ppm-lint-"));
  outDir = join(tmp, "out");
  await mkdir(outDir, { recursive: true });
  userStore = join(tmp, "userdata");
  await mkdir(join(userStore, "user", "u1", "process"), { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new TempConfig({ installDir: join(FIXTURES, "install"), userDataDir: userStore, userId: "u1" }),
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

describe("handleLint", () => {
  it("reports a clean file as clean with no findings and nothing skipped", async () => {
    const path = await writeSource("Tuned", {
      name: "Tuned",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
      outer_wall_speed: ["300", "500", "500"],
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Tuned",
      machineName: MACHINE,
    });

    expect(result).toMatchObject({ kind: "process", name: "Tuned", path, clean: true });
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("reports an override the inherits chain already resolves to the same value", async () => {
    await writeSource("Dead Weight", {
      name: "Dead Weight",
      inherits: "0.20mm Standard @BBL X1C",
      wall_loops: "3",
      outer_wall_speed: ["250", "500", "500"],
      layer_height: "0.16",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Dead Weight",
      machineName: MACHINE,
    });

    expect(result.clean).toBe(false);
    const keys = result.findings.filter((f) => f.check === "parent-equal-override").map((f) => f.key);
    expect(keys).toEqual(["outer_wall_speed", "wall_loops"]);
    expect(result.findings.find((f) => f.key === "wall_loops")?.detail).toContain("3");
    // The genuinely different override stays unreported.
    expect(keys).not.toContain("layer_height");
  });

  it("reports a vector column count that differs from the machine's variant count", async () => {
    await writeSource("Short Array", {
      name: "Short Array",
      inherits: "0.20mm Standard @BBL X1C",
      outer_wall_speed: ["300", "400"],
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Short Array",
      machineName: MACHINE,
    });

    const finding = result.findings.find((f) => f.check === "column-count");
    expect(finding?.key).toBe("outer_wall_speed");
    expect(finding?.detail).toContain("2");
    expect(finding?.detail).toContain("3");
    expect(finding?.detail).toContain(MACHINE);
    expect(result.skipped).toEqual([]);
  });

  it("skips the column count when machineName is absent instead of guessing one", async () => {
    await writeSource("Short Array", {
      name: "Short Array",
      inherits: "0.20mm Standard @BBL X1C",
      outer_wall_speed: ["300", "400"],
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Short Array",
    });

    expect(result.findings.some((f) => f.check === "column-count")).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.check).toBe("column-count");
    expect(result.skipped[0]?.reason).toContain("machineName");
    // A skipped check leaves the verdict to the findings alone.
    expect(result.clean).toBe(true);
  });

  it("reports an array where the schema says scalar and a scalar where it says array", async () => {
    await writeSource("Shapeless", {
      name: "Shapeless",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: ["0.16"],
      outer_wall_speed: "300",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Shapeless",
      machineName: MACHINE,
    });

    const mismatches = result.findings.filter((f) => f.check === "scalar-vector-mismatch");
    expect(mismatches.map((f) => f.key)).toEqual(["layer_height", "outer_wall_speed"]);
    // A shape mismatch supersedes the column count for the same key.
    expect(result.findings.some((f) => f.check === "column-count")).toBe(false);
  });

  it("reports a key the kind's schema lacks", async () => {
    await writeSource("Typo", {
      name: "Typo",
      inherits: "0.20mm Standard @BBL X1C",
      wall_loop: "4",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Typo",
      machineName: MACHINE,
    });

    expect(result.findings).toContainEqual(
      expect.objectContaining({ check: "unknown-key", key: "wall_loop" })
    );
  });

  it("reports a nil column resolving to a value the file already states elsewhere", async () => {
    await writeSource("Noisy PLA", {
      name: "Noisy PLA",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.2", "nil", "0.8"],
    });

    const result = await handleLint(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Noisy PLA",
      machineName: MACHINE,
    });

    const finding = result.findings.find((f) => f.check === "nil-equals-parent");
    expect(finding?.key).toBe("filament_retraction_length");
    expect(finding?.detail).toContain("1");
    expect(finding?.detail).toContain("1.2");
  });

  it("leaves a nil column whose resolved value is stated nowhere else unreported", async () => {
    await writeSource("Quiet PLA", {
      name: "Quiet PLA",
      inherits: "Generic PLA @BBL X1C",
      filament_retraction_length: ["1.5", "nil", "0.5"],
    });

    const result = await handleLint(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Quiet PLA",
      machineName: MACHINE,
    });

    expect(result.findings.some((f) => f.check === "nil-equals-parent")).toBe(false);
  });

  it("groups findings by check in severity order", async () => {
    await writeSource("Everything", {
      name: "Everything",
      inherits: "0.20mm Standard @BBL X1C",
      wall_loops: "3",
      layer_height: ["0.16"],
      bogus_key: "1",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Everything",
      machineName: MACHINE,
    });

    expect(result.findings.map((f) => f.check)).toEqual([
      "parent-equal-override",
      "scalar-vector-mismatch",
      "unknown-key",
    ]);
  });

  it("lints a differently named local file via sourceName", async () => {
    const path = await writeSource("draft-copy", {
      name: "draft-copy",
      inherits: "0.20mm Standard @BBL X1C",
      wall_loops: "3",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Production",
      sourceName: "draft-copy",
      machineName: MACHINE,
    });

    expect(result.path).toBe(path);
    expect(result.name).toBe("Production");
    expect(result.findings.map((f) => f.key)).toEqual(["wall_loops"]);
  });

  it("leaves identity and synthesized metadata out of the findings", async () => {
    await writeSource("Metadata", {
      name: "Metadata",
      inherits: "0.20mm Standard @BBL X1C",
      from: "User",
      version: "2.7.0.8",
      print_settings_id: "Metadata",
      layer_height: "0.16",
    });

    const result = await handleLint(deps(), "process", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Metadata",
      machineName: MACHINE,
    });

    expect(result.findings).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("fails on a missing file, malformed JSON, a non-object file, and a missing inherits", async () => {
    await expect(
      handleLint(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Ghost" })
    ).rejects.toThrow(/not found/i);

    await writeFile(join(outDir, "Broken.json"), "{ not json", "utf8");
    await expect(
      handleLint(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Broken" })
    ).rejects.toThrow(/not valid JSON/i);

    await writeFile(join(outDir, "Listy.json"), "[1, 2, 3]", "utf8");
    await expect(
      handleLint(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Listy" })
    ).rejects.toThrow(/JSON object/i);

    await writeSource("Rootless", { name: "Rootless", layer_height: "0.2" });
    await expect(
      handleLint(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Rootless" })
    ).rejects.toThrow(/'inherits'/);
  });
});
