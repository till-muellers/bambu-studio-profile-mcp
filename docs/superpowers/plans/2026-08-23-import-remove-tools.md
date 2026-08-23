# import_profile / remove_profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `import_profile` and `remove_profile`, installing `write_profile` output into (and deleting user presets from) Bambu Studio's `user/<userId>/{process,filament}` store.

**Architecture:** A small helper module owns the user-preset path/sidecar mechanics; one new tool module carries both handlers as thin compositions of the existing config/store/resolver/validator blocks; `buildServer` registers the two tools.

**Tech Stack:** TypeScript (strict, ESM), Node.js ≥ 20, `@modelcontextprotocol/sdk`, `zod` v3, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-bambu-studio-profile-mcp-design.md` (sections: User preset format, `import_profile`, `remove_profile`, Error handling, Testing)

## Global Constraints

- Tool names are exactly `import_profile` and `remove_profile`; registered ONLY via `server.registerTool()`, business logic in plain exported `handleImport`/`handleRemove`, callbacks are thin wrappers. Total tool count after this plan: 10.
- The system store (`<installDir>/resources/...`) is never written under any circumstance. The ONLY writable Bambu location is `<userDataDir>/user/<userId>/{process,filament}`.
- `from: "User"` refusals (overwrite target, removal target) are hard safety boundaries — no input flag bypasses them. An unparseable existing target counts as unverifiable and is refused.
- `setting_id`/`base_id` are never synthesized; `sync_info` is always written empty. Sidecar is exactly five `key = value` lines in the order sync_info, user_id, setting_id, base_id, updated_time, CRLF line endings, one trailing space after `=` for empty values.
- Pre-import validation is a data-safety requirement: Bambu Studio deletes preset JSONs it cannot parse. Nothing is written to the user store if any check fails.
- All violations of one class are collected and reported together (`{ key, reason }[]` in a `SchemaValidationError`), matching `write_profile`.
- `src/types.ts` and `src/errors.ts` are LOCKED — import, never edit. `ToolDeps` (src/tools/deps.ts) unchanged.
- TypeScript: `strict: true`, no `any` (use `unknown`), explicit `Promise<T>` return types on async functions.
- Tool descriptions in house style: Purpose / Returns / Errors / workflow pointers; parameter detail lives ONLY in the zod schema descriptions; no negations, no roadmap commentary.
- Tests must never write into the checked-in `tests/fixtures/` tree — writable stores are temp directories.
- Test command: `npx vitest run <file>` (per-file) / `npm test` (all). Red-green per step: write failing test → verify fail → implement → verify pass → commit.
- Commit after every task with the message given in the task; work on branch `feat/import-remove-tools` created from main.

---

### Task 1: User-preset helpers (paths, sidecar, setting_id parsing)

**Files:**
- Create: `src/user-presets.ts`
- Modify: `tests/fixtures/install/resources/profiles/BBL/process/fdm_process_common.json` (add one field)
- Test: `tests/user-presets.test.ts`

**Interfaces:**
- Consumes: `ProfileKind`, `ServerConfig` from `src/types.ts`.
- Produces (Task 2 and 3 import these exact names):
  - `const STUDIO_RESTART_NOTE: string`
  - `function userPresetPaths(cfg: ServerConfig, kind: ProfileKind, name: string): { jsonPath: string; infoPath: string }`
  - `function formatInfoSidecar(updatedTime: number): string`
  - `function parseSettingId(infoText: string): string` — the `setting_id` value, `""` when the line is absent or empty.

- [ ] **Step 0: Create the branch**

```bash
git checkout -b feat/import-remove-tools
```

- [ ] **Step 1: Write the failing test `tests/user-presets.test.ts`**

```typescript
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STUDIO_RESTART_NOTE,
  formatInfoSidecar,
  parseSettingId,
  userPresetPaths,
} from "../src/user-presets.js";

const CFG = { installDir: "D:/inst", userDataDir: "D:/data", userId: "1234567890" };

describe("userPresetPaths", () => {
  it("builds the json and info pair inside user/<userId>/<kind>", () => {
    const { jsonPath, infoPath } = userPresetPaths(CFG, "process", "My Draft");
    expect(jsonPath).toBe(join("D:/data", "user", "1234567890", "process", "My Draft.json"));
    expect(infoPath).toBe(join("D:/data", "user", "1234567890", "process", "My Draft.info"));
  });
});

describe("formatInfoSidecar", () => {
  it("emits exactly the five fields in order with CRLF endings and empty ids", () => {
    expect(formatInfoSidecar(1784668006)).toBe(
      "sync_info = \r\n" +
        "user_id = \r\n" +
        "setting_id = \r\n" +
        "base_id = \r\n" +
        "updated_time = 1784668006\r\n"
    );
  });
});

describe("parseSettingId", () => {
  it("extracts a populated setting_id", () => {
    const info =
      "sync_info = \r\nuser_id = 1234567890\r\nsetting_id = PFUS00000000000000\r\nbase_id = GFSG00_14\r\nupdated_time = 1784668006\r\n";
    expect(parseSettingId(info)).toBe("PFUS00000000000000");
  });

  it("returns empty string for an empty or missing setting_id line", () => {
    expect(parseSettingId("sync_info = \r\nsetting_id = \r\nupdated_time = 1\r\n")).toBe("");
    expect(parseSettingId("sync_info = \r\nupdated_time = 1\r\n")).toBe("");
  });
});

describe("STUDIO_RESTART_NOTE", () => {
  it("mentions the restart requirement", () => {
    expect(STUDIO_RESTART_NOTE).toContain("restart");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/user-presets.test.ts`
Expected: FAIL — cannot resolve `../src/user-presets.js`.

- [ ] **Step 3: Write `src/user-presets.ts`**

```typescript
import { join } from "node:path";
import type { ProfileKind, ServerConfig } from "./types.js";

export const STUDIO_RESTART_NOTE = "Bambu Studio picks this up after a restart.";

export function userPresetPaths(
  cfg: ServerConfig,
  kind: ProfileKind,
  name: string
): { jsonPath: string; infoPath: string } {
  const dir = join(cfg.userDataDir, "user", cfg.userId, kind);
  return { jsonPath: join(dir, `${name}.json`), infoPath: join(dir, `${name}.info`) };
}

/** Exact byte layout Bambu Studio's Preset::save_info writes on Windows: five fields, CRLF. */
export function formatInfoSidecar(updatedTime: number): string {
  return (
    "sync_info = \r\n" +
    "user_id = \r\n" +
    "setting_id = \r\n" +
    "base_id = \r\n" +
    `updated_time = ${updatedTime}\r\n`
  );
}

export function parseSettingId(infoText: string): string {
  const match = infoText.match(/^setting_id\s*=[ \t]*(.*?)\s*$/m);
  return match ? match[1] : "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/user-presets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add a `version` field to the process root fixture**

In `tests/fixtures/install/resources/profiles/BBL/process/fdm_process_common.json`, add the field `"version": "2.7.0.8"` after the `"name"` line (keep every other field unchanged). The filament fixtures deliberately stay version-less — Task 2 tests both the copied-version and omitted-version paths through this asymmetry.

- [ ] **Step 6: Verify the full suite still passes**

Run: `npm run build && npm test`
Expected: build clean; all existing tests still pass (the new fixture field flows into resolved settings; no existing test asserts the full settings object of that chain).

- [ ] **Step 7: Commit**

```bash
git add src/user-presets.ts tests/user-presets.test.ts "tests/fixtures/install/resources/profiles/BBL/process/fdm_process_common.json"
git commit -m "feat: user-preset path and sidecar helpers"
```

---

### Task 2: import_profile tool

**Files:**
- Create: `src/tools/import.ts`
- Modify: `src/index.ts` (register), `tests/server.test.ts` (tool-name array only)
- Test: `tests/tools-import.test.ts`

**Interfaces:**
- Consumes: Task 1's `STUDIO_RESTART_NOTE`, `userPresetPaths`, `formatInfoSidecar`; `resolveProfile` (src/resolver.ts); `loadSchema`, `validateKvps` (src/validator.ts); `SchemaValidationError` (src/errors.ts); `ToolDeps`, `toToolError` (src/tools/deps.ts); `ProfileKind`, `RawProfile` (src/types.ts).
- Produces (Task 3 extends this module):
  - `interface ImportResult { kind: ProfileKind; name: string; path: string; infoPath: string; overwritten: boolean; note: string; }`
  - `function handleImport(deps: ToolDeps, kind: ProfileKind, args: { vendor: string; outputDir: string; name: string; overwrite?: boolean }): Promise<ImportResult>`
  - `function registerImportTools(server: McpServer, deps: ToolDeps): void` — registers `import_profile` (Task 3 adds `remove_profile` to this same function).

- [ ] **Step 1: Write the failing test `tests/tools-import.test.ts`**

```typescript
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { SchemaValidationError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleImport } from "../src/tools/import.js";
import type { ServerConfig } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

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
  tmp = await mkdtemp(join(tmpdir(), "ppm-import-"));
  outDir = join(tmp, "out");
  await mkdir(outDir, { recursive: true });
  userStore = join(tmp, "userdata");
  await mkdir(join(userStore, "user", "u1", "process"), { recursive: true });
  await mkdir(join(userStore, "user", "u1", "filament"), { recursive: true });
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

async function writeSource(name: string, body: Record<string, unknown>): Promise<void> {
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(body, null, 4) + "\n", "utf8");
}

const PROCESS_ARGS = { vendor: "BBL", outputDir: "", name: "Imported Draft", overwrite: false };

describe("handleImport", () => {
  it("installs a process preset with synthesized metadata and sidecar", async () => {
    await writeSource("Imported Draft", {
      name: "Imported Draft",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: "0.16",
    });
    const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
    expect(result).toMatchObject({ kind: "process", name: "Imported Draft", overwritten: false });
    expect(result.note).toContain("restart");

    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({
      name: "Imported Draft",
      inherits: "0.20mm Standard @BBL X1C",
      from: "User",
      version: "2.7.0.8",
      print_settings_id: "Imported Draft",
      layer_height: "0.16",
    });

    const info = await readFile(result.infoPath, "utf8");
    expect(info).toMatch(
      /^sync_info = \r\nuser_id = \r\nsetting_id = \r\nbase_id = \r\nupdated_time = \d+\r\n$/
    );
  });

  it("omits version and uses the filament settings-id shape when the chain has no version", async () => {
    await writeSource("Hot PLA", {
      name: "Hot PLA",
      inherits: "Generic PLA @BBL X1C",
      nozzle_temperature: ["230"],
    });
    const result = await handleImport(deps(), "filament", {
      vendor: "BBL",
      outputDir: outDir,
      name: "Hot PLA",
    });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.filament_settings_id).toEqual(["Hot PLA"]);
    expect(onDisk).not.toHaveProperty("version");
    expect(onDisk).not.toHaveProperty("print_settings_id");
  });

  it("rejects invalid source kvps and writes nothing", async () => {
    await writeSource("Broken", { name: "Broken", inherits: "fdm_process_common", bogus_key: "1" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Broken" })
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(await readdir(join(userStore, "user", "u1", "process"))).toEqual([]);
  });

  it("fails when the source file is missing, naming write_profile", async () => {
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Ghost" })
    ).rejects.toThrow(/write_profile/);
  });

  it("fails on an unresolvable inherits target", async () => {
    await writeSource("Orphaned", { name: "Orphaned", inherits: "does_not_exist", layer_height: "0.2" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Orphaned" })
    ).rejects.toThrow(/does_not_exist/);
    expect(await readdir(join(userStore, "user", "u1", "process"))).toEqual([]);
  });

  it("refuses an existing target without overwrite, replaces it with overwrite", async () => {
    await writeSource("Twice", { name: "Twice", inherits: "fdm_process_common", layer_height: "0.2" });
    const args = { vendor: "BBL", outputDir: outDir, name: "Twice" };
    await handleImport(deps(), "process", args);
    await expect(handleImport(deps(), "process", args)).rejects.toThrow(/overwrite/);

    await writeSource("Twice", { name: "Twice", inherits: "fdm_process_common", layer_height: "0.3" });
    const second = await handleImport(deps(), "process", { ...args, overwrite: true });
    expect(second.overwritten).toBe(true);
    expect(JSON.parse(await readFile(second.path, "utf8")).layer_height).toBe("0.3");
  });

  it("refuses to overwrite a target whose from is not User, even with the flag", async () => {
    await writeSource("Sacred", { name: "Sacred", inherits: "fdm_process_common", layer_height: "0.2" });
    const target = join(userStore, "user", "u1", "process", "Sacred.json");
    await writeFile(target, JSON.stringify({ name: "Sacred", from: "system" }), "utf8");
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Sacred", overwrite: true })
    ).rejects.toThrow(/from/);
    expect(JSON.parse(await readFile(target, "utf8")).from).toBe("system");
  });

  it("refuses to overwrite an unparseable target, even with the flag", async () => {
    await writeSource("Murky", { name: "Murky", inherits: "fdm_process_common", layer_height: "0.2" });
    const target = join(userStore, "user", "u1", "process", "Murky.json");
    await writeFile(target, "{ not json", "utf8");
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Murky", overwrite: true })
    ).rejects.toThrow(/verify/);
    expect(await readFile(target, "utf8")).toBe("{ not json");
  });

  it("fails when the source has no inherits field", async () => {
    await writeSource("Rootless", { name: "Rootless", layer_height: "0.2" });
    await expect(
      handleImport(deps(), "process", { vendor: "BBL", outputDir: outDir, name: "Rootless" })
    ).rejects.toThrow(/inherits/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools-import.test.ts`
Expected: FAIL — cannot resolve `../src/tools/import.js`.

- [ ] **Step 3: Write `src/tools/import.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { resolveProfile } from "../resolver.js";
import type { ProfileKind, RawProfile } from "../types.js";
import {
  STUDIO_RESTART_NOTE,
  formatInfoSidecar,
  userPresetPaths,
} from "../user-presets.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface ImportResult {
  kind: ProfileKind;
  name: string;
  path: string;
  infoPath: string;
  overwritten: boolean;
  note: string;
}

export async function handleImport(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; outputDir: string; name: string; overwrite?: boolean }
): Promise<ImportResult> {
  const cfg = await deps.config.require();

  const sourcePath = join(args.outputDir, `${args.name}.json`);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source profile '${sourcePath}' not found. Create it with write_profile first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch {
    throw new Error(`Source profile '${sourcePath}' is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Source profile '${sourcePath}' does not contain a JSON object.`);
  }
  const source = parsed as RawProfile;
  if (typeof source.inherits !== "string" || source.inherits === "") {
    throw new Error(`Source profile '${sourcePath}' has no 'inherits' field.`);
  }

  const kvps = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "name" && key !== "inherits")
  );
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const violations = validateKvps(schema, kvps);
  if (violations.length > 0) throw new SchemaValidationError(violations);

  const store = deps.storeFactory(cfg);
  const resolvedBase = await resolveProfile(store, kind, args.vendor, source.inherits);

  const { jsonPath, infoPath } = userPresetPaths(cfg, kind, args.name);
  const overwritten = existsSync(jsonPath);
  if (overwritten) {
    if (!args.overwrite) {
      throw new Error(`Target preset '${jsonPath}' already exists. Pass overwrite: true to replace it.`);
    }
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch {
      throw new Error(
        `Refusing to overwrite '${jsonPath}': cannot verify it is a user preset (unparseable JSON).`
      );
    }
    if ((existing as RawProfile).from !== "User") {
      throw new Error(`Refusing to overwrite '${jsonPath}': its 'from' field is not "User".`);
    }
  }

  const version = resolvedBase.settings.version;
  const body: Record<string, unknown> = {
    name: args.name,
    inherits: source.inherits,
    from: "User",
    ...(typeof version === "string" ? { version } : {}),
    ...(kind === "process"
      ? { print_settings_id: args.name }
      : { filament_settings_id: [args.name] }),
    ...kvps,
  };
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(body, null, 4) + "\n", "utf8");
  await writeFile(infoPath, formatInfoSidecar(Math.floor(Date.now() / 1000)), "utf8");

  return { kind, name: args.name, path: jsonPath, infoPath, overwritten, note: STUDIO_RESTART_NOTE };
}

const importInputShape = {
  kind: z.enum(["process", "filament"]).describe("Profile type to import"),
  vendor: z
    .string()
    .min(1)
    .describe("Vendor id from list_vendors, e.g. 'BBL'; names the system store the source's inherits chain is resolved against"),
  outputDir: z.string().min(1).describe("Directory containing the source file written by write_profile"),
  name: z.string().min(1).describe("Name of the profile to import; locates <outputDir>/<name>.json and names the installed preset"),
  overwrite: z
    .boolean()
    .optional()
    .describe("Pass true to replace an existing user preset of the same name; defaults to false"),
};

export function registerImportTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "import_profile",
    {
      title: "Import profile",
      description:
        "Install a profile file written by write_profile into Bambu Studio's user preset store " +
        "(user/<userId>/<kind>/), synthesizing the metadata Bambu Studio expects (from, version, " +
        "settings id) and a minimal .info sidecar. The source is fully re-validated against the " +
        "option schema first and its inherits chain is resolved; nothing is installed when any " +
        "check fails. Replacing an existing preset requires overwrite: true and only ever replaces " +
        "presets whose own 'from' field is \"User\".\n\n" +
        "Returns: { kind, name, path, infoPath, overwritten, note } — note states that Bambu Studio " +
        "sees the preset after a restart.\n\n" +
        "Errors: source missing or unparseable; schema violations listed per key; vendor or inherits " +
        "target not found; target exists without overwrite; target's 'from' is not \"User\" (refused " +
        "regardless of flags); config missing (run init_config first).\n\n" +
        "Typical flow: write_profile into an outputDir, then import_profile with the same " +
        "outputDir/name. Remove an installed preset again with remove_profile.",
      inputSchema: importInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; vendor: string; outputDir: string; name: string; overwrite?: boolean }) => {
      try {
        const result = await handleImport(deps, args.kind, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools-import.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Register in `src/index.ts` and update the server test's tool list**

In `src/index.ts`: add `import { registerImportTools } from "./tools/import.js";` and call `registerImportTools(server, deps);` inside `buildServer` after the existing register calls.

In `tests/server.test.ts`: in the tool-name-array test, add `"import_profile"` keeping the array sorted, and update the test title's tool count (eight → nine). Touch nothing else in that file.

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm run build && npm test`
Expected: build clean; all tests pass including the updated server test.

- [ ] **Step 7: Commit**

```bash
git add src/tools/import.ts src/index.ts tests/tools-import.test.ts tests/server.test.ts
git commit -m "feat: import_profile tool installing presets into the Bambu user store"
```

---

### Task 3: remove_profile tool, protocol coverage, README

**Files:**
- Modify: `src/tools/import.ts` (add handler + registration), `tests/server.test.ts` (tool array + two protocol tests), `README.md`
- Test: `tests/tools-remove.test.ts`

**Interfaces:**
- Consumes: Task 1's `STUDIO_RESTART_NOTE`, `userPresetPaths`, `parseSettingId`, `formatInfoSidecar`; Task 2's `registerImportTools` (extended in place); `ToolDeps`, `toToolError`; `ProfileKind`, `RawProfile`.
- Produces:
  - `interface RemoveResult { kind: ProfileKind; name: string; removedJson: string; removedInfo: string | null; cloudRecord: boolean; note: string; }`
  - `function handleRemove(deps: ToolDeps, kind: ProfileKind, args: { name: string }): Promise<RemoveResult>`
  - `registerImportTools` now also registers `remove_profile`.

- [ ] **Step 1: Write the failing test `tests/tools-remove.test.ts`**

```typescript
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleRemove } from "../src/tools/import.js";
import type { ServerConfig } from "../src/types.js";
import { formatInfoSidecar } from "../src/user-presets.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class TempConfig extends ConfigManager {
  constructor(private readonly cfg: ServerConfig) {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load(): Promise<ServerConfig | null> {
    return this.cfg;
  }
}

let tmp: string;
let processDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ppm-remove-"));
  processDir = join(tmp, "user", "u1", "process");
  await mkdir(processDir, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new TempConfig({ installDir: join(FIXTURES, "install"), userDataDir: tmp, userId: "u1" }),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

async function seed(name: string, body: Record<string, unknown>, info?: string): Promise<void> {
  await writeFile(join(processDir, `${name}.json`), JSON.stringify(body, null, 4), "utf8");
  if (info !== undefined) await writeFile(join(processDir, `${name}.info`), info, "utf8");
}

describe("handleRemove", () => {
  it("removes the json+info pair of a user preset without a cloud record", async () => {
    await seed("Local Draft", { name: "Local Draft", from: "User" }, formatInfoSidecar(1784668006));
    const result = await handleRemove(deps(), "process", { name: "Local Draft" });
    expect(result.cloudRecord).toBe(false);
    expect(result.removedInfo).toBe(join(processDir, "Local Draft.info"));
    expect(result.note).toContain("restart");
    expect(existsSync(join(processDir, "Local Draft.json"))).toBe(false);
    expect(existsSync(join(processDir, "Local Draft.info"))).toBe(false);
  });

  it("flags cloudRecord and warns when setting_id is populated", async () => {
    const info =
      "sync_info = \r\nuser_id = u1\r\nsetting_id = PPUS123\r\nbase_id = GP155\r\nupdated_time = 1\r\n";
    await seed("Synced Draft", { name: "Synced Draft", from: "User" }, info);
    const result = await handleRemove(deps(), "process", { name: "Synced Draft" });
    expect(result.cloudRecord).toBe(true);
    expect(result.note).toMatch(/sync/i);
    expect(existsSync(join(processDir, "Synced Draft.json"))).toBe(false);
  });

  it("removes a preset without a sidecar, reporting removedInfo null", async () => {
    await seed("Bare Draft", { name: "Bare Draft", from: "User" });
    const result = await handleRemove(deps(), "process", { name: "Bare Draft" });
    expect(result.removedInfo).toBeNull();
    expect(existsSync(join(processDir, "Bare Draft.json"))).toBe(false);
  });

  it("refuses when from is not User", async () => {
    await seed("Foreign", { name: "Foreign", from: "system" });
    await expect(handleRemove(deps(), "process", { name: "Foreign" })).rejects.toThrow(/from/);
    expect(existsSync(join(processDir, "Foreign.json"))).toBe(true);
  });

  it("refuses an unparseable preset json", async () => {
    await writeFile(join(processDir, "Murky.json"), "{ not json", "utf8");
    await expect(handleRemove(deps(), "process", { name: "Murky" })).rejects.toThrow(/verify/);
    expect(existsSync(join(processDir, "Murky.json"))).toBe(true);
  });

  it("errors on a stray sidecar without its json", async () => {
    await writeFile(join(processDir, "Stray.info"), formatInfoSidecar(1), "utf8");
    await expect(handleRemove(deps(), "process", { name: "Stray" })).rejects.toThrow(/Stray\.info/);
    expect(existsSync(join(processDir, "Stray.info"))).toBe(true);
  });

  it("errors when the preset is not found at all", async () => {
    await expect(handleRemove(deps(), "process", { name: "Ghost" })).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools-remove.test.ts`
Expected: FAIL — `handleRemove` is not exported from `../src/tools/import.js`.

- [ ] **Step 3: Add the handler and registration to `src/tools/import.ts`**

Add `rm` to the existing `node:fs/promises` import and `parseSettingId` to the `../user-presets.js` import, then append:

```typescript
export interface RemoveResult {
  kind: ProfileKind;
  name: string;
  removedJson: string;
  removedInfo: string | null;
  cloudRecord: boolean;
  note: string;
}

export async function handleRemove(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { name: string }
): Promise<RemoveResult> {
  const cfg = await deps.config.require();
  const { jsonPath, infoPath } = userPresetPaths(cfg, kind, args.name);
  const infoExists = existsSync(infoPath);

  if (!existsSync(jsonPath)) {
    if (infoExists) {
      throw new Error(
        `Preset JSON '${jsonPath}' is missing but a stray sidecar '${infoPath}' exists; nothing was removed.`
      );
    }
    throw new Error(`Preset '${jsonPath}' not found in the user store.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    throw new Error(`Refusing to remove '${jsonPath}': cannot verify it is a user preset (unparseable JSON).`);
  }
  if ((parsed as RawProfile).from !== "User") {
    throw new Error(`Refusing to remove '${jsonPath}': its 'from' field is not "User".`);
  }

  let cloudRecord = false;
  if (infoExists) {
    cloudRecord = parseSettingId(await readFile(infoPath, "utf8")) !== "";
  }

  await rm(jsonPath);
  if (infoExists) await rm(infoPath);

  const note = cloudRecord
    ? `${STUDIO_RESTART_NOTE} A cloud record exists for this preset; Bambu Studio's sync may restore it.`
    : STUDIO_RESTART_NOTE;
  return {
    kind,
    name: args.name,
    removedJson: jsonPath,
    removedInfo: infoExists ? infoPath : null,
    cloudRecord,
    note,
  };
}

const removeInputShape = {
  kind: z.enum(["process", "filament"]).describe("Profile type to remove"),
  name: z.string().min(1).describe("Name of the user preset to remove from user/<userId>/<kind>/"),
};

function registerRemoveProfile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "remove_profile",
    {
      title: "Remove profile",
      description:
        "Delete a user preset (its JSON plus .info sidecar) from Bambu Studio's user preset store " +
        "(user/<userId>/<kind>/). Only presets whose own 'from' field is \"User\" are removable. " +
        "When the preset has a cloud record (populated setting_id in its sidecar) it is still " +
        "removed locally and the result flags cloudRecord: true, since Bambu Studio's sync may " +
        "restore it.\n\n" +
        "Returns: { kind, name, removedJson, removedInfo, cloudRecord, note } — removedInfo is null " +
        "when no sidecar existed; note states that Bambu Studio sees the change after a restart.\n\n" +
        "Errors: preset not found; a stray sidecar without its JSON; the preset's 'from' is not " +
        "\"User\" or its JSON is unparseable (refused regardless of flags); config missing (run " +
        "init_config first).\n\n" +
        "Discover installed user presets with list_profiles (source \"user\").",
      inputSchema: removeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; name: string }) => {
      try {
        const result = await handleRemove(deps, args.kind, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Then extend the existing `registerImportTools` body to call `registerRemoveProfile(server, deps);` after the `import_profile` registration (keep the exported function name unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools-remove.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Update `tests/server.test.ts` — tool array and protocol coverage**

(a) Add `"remove_profile"` to the tool-name array (keeping it sorted; count in the title becomes ten).

(b) Append two protocol-level tests inside the existing `describe` block, following the file's existing patterns (`connectedClient()` + `client.callTool`). The fixture deps in that file point `userDataDir` at the checked-in fixtures, which tests must not write — so these tests build their own deps against a temp store, mirroring the pattern used in tests/tools-import.test.ts:

```typescript
it("serves import_profile and remove_profile end-to-end over the protocol", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ppm-proto-"));
  try {
    const outDir = join(tmp, "out");
    await mkdir(join(tmp, "userdata", "user", "u1", "process"), { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, "Proto Draft.json"),
      JSON.stringify({ name: "Proto Draft", inherits: "fdm_process_common", layer_height: "0.16" }),
      "utf8"
    );
    class ProtoConfig extends ConfigManager {
      constructor() {
        super(join(FIXTURES, "does-not-exist.json"));
      }
      override async load(): Promise<ServerConfig | null> {
        return { installDir: join(FIXTURES, "install"), userDataDir: join(tmp, "userdata"), userId: "u1" };
      }
    }
    const server = buildServer({
      config: new ProtoConfig(),
      storeFactory: (cfg) => new FsProfileStore(cfg),
      schemaDir: join(FIXTURES, "schema"),
      detectPaths: async () => ({}),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const imported = await client.callTool({
      name: "import_profile",
      arguments: { kind: "process", vendor: "BBL", outputDir: outDir, name: "Proto Draft" },
    });
    expect(imported.isError).toBeFalsy();
    expect(imported.structuredContent).toMatchObject({ kind: "process", overwritten: false });

    const removed = await client.callTool({
      name: "remove_profile",
      arguments: { kind: "process", name: "Proto Draft" },
    });
    expect(removed.isError).toBeFalsy();
    expect(removed.structuredContent).toMatchObject({ cloudRecord: false, removedInfo: expect.any(String) });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

Add the imports this needs at the top of tests/server.test.ts if not present: `mkdtemp, mkdir, rm, writeFile` from `node:fs/promises`, `tmpdir` from `node:os`, and `ServerConfig` type from `../src/types.js`.

- [ ] **Step 6: README**

In the Tools section of README.md, add two bullets after the update_profile bullet, matching the existing bullet style:

```markdown
- `import_profile` — install a written profile file into Bambu Studio's user preset store (metadata and `.info` sidecar synthesized; overwrite requires an explicit flag; Bambu Studio sees it after a restart).
- `remove_profile` — delete a user preset (JSON + `.info`) from the store; only presets marked `"from": "User"`; flags presets that have a cloud record.
```

- [ ] **Step 7: Verify the whole suite and the build**

Run: `npm run build && npm test`
Expected: build clean; every test file passes, output pristine apart from the known warnIfUnconfigured stderr line.

- [ ] **Step 8: Commit**

```bash
git add src/tools/import.ts tests/tools-remove.test.ts tests/server.test.ts README.md
git commit -m "feat: remove_profile tool and protocol coverage for the user store"
```

---

## Self-Review Notes

- Spec coverage: User preset format facts → Task 1 (sidecar bytes, paths) and Task 2 (metadata synthesis, never-synthesized ids); `import_profile` behavior 1-4 + overwrite contract + errors → Task 2; `remove_profile` behavior 1-3 + errors → Task 3; error-handling safety-refusal class → refusal tests in Tasks 2/3; Testing section items map one-to-one onto the listed test cases; restart note → STUDIO_RESTART_NOTE asserted in both handler test files.
- Interface consistency: `userPresetPaths`/`formatInfoSidecar`/`parseSettingId`/`STUDIO_RESTART_NOTE` (Task 1) are consumed with identical signatures in Tasks 2/3; `registerImportTools` keeps its name when Task 3 extends it; `handleImport`/`handleRemove` signatures match their protocol-callback usage.
- The version-copy path is exercised through the Task 1 fixture change (process chain carries `"version": "2.7.0.8"`, filament chain stays version-less).
