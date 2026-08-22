# printing-profile-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `printing-profile-mcp` server exposing five tools that resolve and schema-validate-write Bambu Studio process/filament profiles.

**Architecture:** A foundation task locks all shared types, error classes, and test fixtures. Five independent building blocks (config, profile store, resolver, validator, schema generator) are then built in parallel against those locked interfaces. Tool tasks compose the blocks; a final task wires the MCP server entry point.

**Tech Stack:** TypeScript (strict, ESM), Node.js ≥ 20, `@modelcontextprotocol/sdk`, `zod` v3, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-bambu-studio-profile-mcp-design.md`

## Global Constraints

- Tool names are exactly: `resolve_process_profile`, `resolve_filament_profile`, `write_process_profile`, `write_filament_profile`, `init_config`.
- MCP server name: `printing-profile-mcp`. Transport: stdio only.
- Register tools ONLY via `server.registerTool()` — never `server.tool()` or manual request handlers.
- Every tool handler's business logic lives in a plain exported function (`handleX(deps, args)`); the `registerTool` callback is a thin wrapper. Tests target the plain functions.
- Vendor is an explicit argument on every resolve/write call; tools hold no session state.
- `config.json` (repo root) is machine-specific and gitignored. It stores `installDir`/`userDataDir` only.
- Schema files live at `schema/process.schema.json` and `schema/filament.schema.json` (repo root). The server reads them at runtime; it never parses C++.
- All schema violations in a request are collected and reported together as `{ key, reason }[]`, never just the first.
- Bambu Studio wraps scalars in single-element string arrays (`["0.2"]`); the validator must accept both the wrapped and the bare form when `serializedAsArray` is true.
- TypeScript: `strict: true`, no `any` (use `unknown`), explicit `Promise<T>` return types on async functions.
- Test command: `npx vitest run <file>` (per-file) / `npm test` (all). Every task follows red-green: write failing test → see it fail → implement → see it pass → commit.
- Commit after every task with the message given in the task. Do not batch tasks into one commit.

## Parallel Execution Guide

```
Wave 0 (serial):    Task 1  (scaffold + types + errors + fixtures)
Wave 1 (parallel):  Task 2  (config)
                    Task 3  (profile store)
                    Task 4  (resolver)
                    Task 5  (kvps validator)
                    Task 6  (schema generator script)
Wave 2 (parallel):  Task 7  (resolve tools)      — needs 3, 4
                    Task 8  (write tools)        — needs 3, 4, 5
                    Task 9  (init_config tool)   — needs 2
Wave 3 (serial):    Task 10 (server entry + integration + README)
```

Wave-1 tasks share no files: each creates exactly one `src/` module and one test file. Wave-2 tasks each create one `src/tools/` module and one test file. Only Tasks 1 and 10 touch shared files. Agents working the same wave must not edit `src/types.ts` or `src/errors.ts` — if an interface there proves wrong, stop and escalate to the orchestrator instead of editing it.

---

### Task 1: Scaffold, shared contracts, test fixtures

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/types.ts`, `src/errors.ts`
- Create: `tests/fixtures/**` (listed below)
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type and error class all later tasks import. These are LOCKED after this task — later tasks import, never edit.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "printing-profile-mcp",
  "version": "0.1.0",
  "description": "MCP server for resolving and writing Bambu Studio process/filament profiles",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
config.json
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: completes without errors; `package-lock.json` created.

- [ ] **Step 5: Write `src/types.ts`**

```typescript
export type ProfileKind = "process" | "filament";

export interface ServerConfig {
  installDir: string;
  userDataDir: string;
}

/** A profile JSON file as read from disk. */
export interface RawProfile {
  name: string;
  inherits?: string;
  [key: string]: unknown;
}

export interface ProfileHit {
  profile: RawProfile;
  source: "user" | "system";
  path: string;
}

/** Lookup/write abstraction over the system + user preset stores. */
export interface ProfileStore {
  /** User store first, then system store under the given vendor. Null if absent in both. */
  findProfile(kind: ProfileKind, vendor: string, name: string): Promise<ProfileHit | null>;
  /** Create or overwrite a user preset. `body` is written verbatim as pretty-printed JSON. */
  writeUserPreset(
    kind: ProfileKind,
    name: string,
    body: Record<string, unknown>
  ): Promise<{ path: string; created: boolean }>;
}

export interface ResolvedProfile {
  vendor: string;
  name: string;
  kind: ProfileKind;
  chain: string[];
  settings: Record<string, unknown>;
}

export type SchemaType = "string" | "int" | "float" | "bool" | "enum" | "percent";

export interface SchemaOption {
  type: SchemaType;
  enum?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  /** True when Bambu Studio stores this option as a single-element string array. */
  serializedAsArray: boolean;
}

export type ProfileSchema = Record<string, SchemaOption>;

export interface Violation {
  key: string;
  reason: string;
}
```

- [ ] **Step 6: Write the failing test `tests/errors.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  CircularInheritanceError,
  ConfigMissingError,
  ProfileNotFoundError,
  SchemaValidationError,
  UserStoreError,
  VendorNotFoundError,
} from "../src/errors.js";

describe("errors", () => {
  it("SchemaValidationError carries all violations", () => {
    const err = new SchemaValidationError([
      { key: "layer_height", reason: "out of range" },
      { key: "bogus_key", reason: "unknown key" },
    ]);
    expect(err.violations).toHaveLength(2);
    expect(err.message).toContain("layer_height");
    expect(err.message).toContain("bogus_key");
  });

  it("ConfigMissingError names init_config as the fix", () => {
    expect(new ConfigMissingError().message).toContain("init_config");
  });

  it("all error classes are instanceof Error with a name", () => {
    for (const err of [
      new VendorNotFoundError("BBL"),
      new ProfileNotFoundError("process", "X"),
      new CircularInheritanceError(["a", "b", "a"]),
      new UserStoreError("no user dir"),
    ]) {
      expect(err).toBeInstanceOf(Error);
      expect(err.name).not.toBe("Error");
    }
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL — cannot resolve `../src/errors.js`.

- [ ] **Step 8: Write `src/errors.ts`**

```typescript
import type { Violation } from "./types.js";

export class VendorNotFoundError extends Error {
  constructor(vendor: string) {
    super(`Vendor '${vendor}' not found under resources/profiles.`);
    this.name = "VendorNotFoundError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(kind: string, name: string) {
    super(`${kind} profile '${name}' not found in user or system presets.`);
    this.name = "ProfileNotFoundError";
  }
}

export class CircularInheritanceError extends Error {
  constructor(chain: string[]) {
    super(`Circular inherits chain: ${chain.join(" -> ")}`);
    this.name = "CircularInheritanceError";
  }
}

export class SchemaValidationError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(
      `Schema validation failed:\n` +
        violations.map((v) => `- ${v.key}: ${v.reason}`).join("\n")
    );
    this.name = "SchemaValidationError";
    this.violations = violations;
  }
}

export class ConfigMissingError extends Error {
  constructor() {
    super(
      "Bambu Studio paths are not configured and auto-detection failed. " +
        "Call the init_config tool with installDir and userDataDir."
    );
    this.name = "ConfigMissingError";
  }
}

export class UserStoreError extends Error {
  constructor(detail: string) {
    super(`User preset store problem: ${detail}`);
    this.name = "UserStoreError";
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Create the profile fixtures**

Create these files exactly. All value wrapping uses Bambu's single-element string arrays.

`tests/fixtures/install/resources/profiles/BBL/process/fdm_process_common.json`
```json
{
  "name": "fdm_process_common",
  "layer_height": ["0.2"],
  "wall_loops": ["2"],
  "sparse_infill_density": ["15%"],
  "wall_generator": ["classic"]
}
```

`tests/fixtures/install/resources/profiles/BBL/process/0.20mm Standard @BBL X1C.json`
```json
{
  "name": "0.20mm Standard @BBL X1C",
  "inherits": "fdm_process_common",
  "wall_loops": ["3"]
}
```

`tests/fixtures/install/resources/profiles/BBL/process/proc_cycle_a.json`
```json
{ "name": "proc_cycle_a", "inherits": "proc_cycle_b" }
```

`tests/fixtures/install/resources/profiles/BBL/process/proc_cycle_b.json`
```json
{ "name": "proc_cycle_b", "inherits": "proc_cycle_a" }
```

`tests/fixtures/install/resources/profiles/BBL/process/proc_orphan.json`
```json
{ "name": "proc_orphan", "inherits": "does_not_exist" }
```

`tests/fixtures/install/resources/profiles/BBL/filament/fdm_filament_common.json`
```json
{
  "name": "fdm_filament_common",
  "filament_type": ["PLA"],
  "nozzle_temperature": ["220"]
}
```

`tests/fixtures/install/resources/profiles/BBL/filament/Generic PLA @BBL X1C.json`
```json
{
  "name": "Generic PLA @BBL X1C",
  "inherits": "fdm_filament_common",
  "nozzle_temperature": ["210"]
}
```

`tests/fixtures/install/resources/profiles_template/.gitkeep` — empty file.

`tests/fixtures/userdata/user/12345/process/My Custom Draft.json`
```json
{
  "name": "My Custom Draft",
  "inherits": "0.20mm Standard @BBL X1C",
  "layer_height": ["0.28"]
}
```

`tests/fixtures/userdata/user/12345/filament/.gitkeep` — empty file.

- [ ] **Step 11: Create the schema fixtures**

`tests/fixtures/schema/process.schema.json`
```json
{
  "layer_height": { "type": "float", "min": 0.04, "max": 1.0, "default": 0.2, "serializedAsArray": true },
  "wall_loops": { "type": "int", "min": 0, "max": 1000, "default": 2, "serializedAsArray": true },
  "enable_support": { "type": "bool", "default": false, "serializedAsArray": true },
  "wall_generator": { "type": "enum", "enum": ["classic", "arachne"], "default": "classic", "serializedAsArray": true },
  "sparse_infill_density": { "type": "percent", "min": 0, "max": 100, "default": 15, "serializedAsArray": true },
  "notes": { "type": "string", "default": "", "serializedAsArray": false }
}
```

`tests/fixtures/schema/filament.schema.json`
```json
{
  "nozzle_temperature": { "type": "int", "min": 0, "max": 350, "default": 220, "serializedAsArray": true },
  "filament_type": { "type": "enum", "enum": ["PLA", "PETG", "ABS", "TPU"], "default": "PLA", "serializedAsArray": true }
}
```

- [ ] **Step 12: Verify build and full test run**

Run: `npm run build && npm test`
Expected: build succeeds; 1 test file, all passing.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with shared types, errors, and test fixtures"
```

---

### Task 2: Config manager with auto-detection

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `ServerConfig`, `ConfigMissingError` from Task 1.
- Produces:
  - `class ConfigManager { constructor(configPath: string, detect?: () => ServerConfig | null); load(): Promise<ServerConfig | null>; require(): Promise<ServerConfig>; save(cfg: ServerConfig): Promise<string>; }`
  - `function validateConfigPaths(cfg: ServerConfig): Promise<string[]>` — empty array means valid.
  - `function detectDefaultPaths(): ServerConfig | null`

- [ ] **Step 1: Write the failing test `tests/config.test.ts`**

```typescript
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager, validateConfigPaths } from "../src/config.js";
import { ConfigMissingError } from "../src/errors.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const VALID = {
  installDir: join(FIXTURES, "install"),
  userDataDir: join(FIXTURES, "userdata"),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ppm-config-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ConfigManager.load", () => {
  it("returns the persisted config when config.json exists", async () => {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify(VALID));
    const mgr = new ConfigManager(path, () => null);
    expect(await mgr.load()).toEqual(VALID);
  });

  it("falls back to auto-detection when config.json is absent", async () => {
    const mgr = new ConfigManager(join(dir, "config.json"), () => VALID);
    expect(await mgr.load()).toEqual(VALID);
  });

  it("returns null when neither exists", async () => {
    const mgr = new ConfigManager(join(dir, "config.json"), () => null);
    expect(await mgr.load()).toBeNull();
  });
});

describe("ConfigManager.require", () => {
  it("throws ConfigMissingError naming init_config when unconfigured", async () => {
    const mgr = new ConfigManager(join(dir, "config.json"), () => null);
    await expect(mgr.require()).rejects.toBeInstanceOf(ConfigMissingError);
  });
});

describe("ConfigManager.save", () => {
  it("persists config.json and load() reads it back without re-detecting", async () => {
    const path = join(dir, "config.json");
    const mgr = new ConfigManager(path, () => null);
    const persistedTo = await mgr.save(VALID);
    expect(persistedTo).toBe(path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(VALID);
    expect(await mgr.load()).toEqual(VALID);
  });
});

describe("validateConfigPaths", () => {
  it("accepts the fixture layout", async () => {
    expect(await validateConfigPaths(VALID)).toEqual([]);
  });

  it("reports installDir without resources/profiles and userDataDir without user/", async () => {
    const problems = await validateConfigPaths({ installDir: dir, userDataDir: dir });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("resources");
    expect(problems[1]).toContain("user");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Write `src/config.ts`**

```typescript
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigMissingError } from "./errors.js";
import type { ServerConfig } from "./types.js";

/** Best-effort per-OS candidates; returns the first pair whose layout checks pass. */
export function detectDefaultPaths(): ServerConfig | null {
  const installCandidates: string[] = [];
  const userDataCandidates: string[] = [];
  if (process.platform === "win32") {
    installCandidates.push("C:\\Program Files\\Bambu Studio");
    if (process.env.APPDATA) userDataCandidates.push(join(process.env.APPDATA, "BambuStudio"));
  } else if (process.platform === "darwin") {
    installCandidates.push("/Applications/BambuStudio.app/Contents/Resources/..");
    userDataCandidates.push(join(homedir(), "Library", "Application Support", "BambuStudio"));
  } else {
    installCandidates.push("/usr/share/BambuStudio", "/opt/bambustudio");
    userDataCandidates.push(join(homedir(), ".config", "BambuStudio"));
  }
  const installDir = installCandidates.find((d) => existsSync(join(d, "resources", "profiles")));
  const userDataDir = userDataCandidates.find((d) => existsSync(join(d, "user")));
  if (!installDir || !userDataDir) return null;
  return { installDir, userDataDir };
}

export async function validateConfigPaths(cfg: ServerConfig): Promise<string[]> {
  const problems: string[] = [];
  if (!existsSync(join(cfg.installDir, "resources", "profiles"))) {
    problems.push(`installDir '${cfg.installDir}' does not contain resources/profiles.`);
  }
  if (!existsSync(join(cfg.userDataDir, "user"))) {
    problems.push(`userDataDir '${cfg.userDataDir}' does not contain a user/ preset store.`);
  }
  return problems;
}

export class ConfigManager {
  constructor(
    private readonly configPath: string,
    private readonly detect: () => ServerConfig | null = detectDefaultPaths
  ) {}

  async load(): Promise<ServerConfig | null> {
    if (existsSync(this.configPath)) {
      const raw: unknown = JSON.parse(await readFile(this.configPath, "utf8"));
      const cfg = raw as ServerConfig;
      if (typeof cfg.installDir === "string" && typeof cfg.userDataDir === "string") {
        return { installDir: cfg.installDir, userDataDir: cfg.userDataDir };
      }
    }
    return this.detect();
  }

  async require(): Promise<ServerConfig> {
    const cfg = await this.load();
    if (!cfg) throw new ConfigMissingError();
    return cfg;
  }

  async save(cfg: ServerConfig): Promise<string> {
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    return this.configPath;
  }
}
```

Note: the macOS install candidate is best-effort only; auto-detection failing there is handled by design via `init_config`. Do not spend time perfecting candidates — `detect` is injectable and tested via injection.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config manager with persistence and per-OS auto-detection"
```

---

### Task 3: Filesystem profile store

**Files:**
- Create: `src/profile-store.ts`
- Test: `tests/profile-store.test.ts`

**Interfaces:**
- Consumes: `ProfileStore`, `ProfileHit`, `ProfileKind`, `RawProfile`, `ServerConfig` types and `VendorNotFoundError`, `UserStoreError` from Task 1.
- Produces: `class FsProfileStore implements ProfileStore { constructor(cfg: ServerConfig) }`.

Lookup semantics (locked): profiles are matched by the `name` field inside each JSON file, not by filename. `findProfile` searches the user store first (`<userDataDir>/user/<id>/<kind>/*.json`, across ALL `<id>` directories), then the system store (`<installDir>/resources/profiles/<vendor>/<kind>/*.json`). A missing vendor directory throws `VendorNotFoundError` only when the user store also had no hit. `writeUserPreset` requires exactly one `user/<id>` directory; zero or multiple throw `UserStoreError` (the exact multi-account layout is a spec-flagged open point — failing loudly is the designed behavior). The file is written as `<name>.json` inside `user/<id>/<kind>/`.

- [ ] **Step 1: Write the failing test `tests/profile-store.test.ts`**

```typescript
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserStoreError, VendorNotFoundError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function fixtureStore(): FsProfileStore {
  return new FsProfileStore({
    installDir: join(FIXTURES, "install"),
    userDataDir: join(FIXTURES, "userdata"),
  });
}

describe("FsProfileStore.findProfile", () => {
  it("finds a system process profile by its name field", async () => {
    const hit = await fixtureStore().findProfile("process", "BBL", "0.20mm Standard @BBL X1C");
    expect(hit?.source).toBe("system");
    expect(hit?.profile.inherits).toBe("fdm_process_common");
  });

  it("finds a user preset before the system store", async () => {
    const hit = await fixtureStore().findProfile("process", "BBL", "My Custom Draft");
    expect(hit?.source).toBe("user");
    expect(hit?.profile.layer_height).toEqual(["0.28"]);
  });

  it("finds a filament profile under the filament kind", async () => {
    const hit = await fixtureStore().findProfile("filament", "BBL", "Generic PLA @BBL X1C");
    expect(hit?.source).toBe("system");
  });

  it("returns null for an unknown profile in a known vendor", async () => {
    expect(await fixtureStore().findProfile("process", "BBL", "nope")).toBeNull();
  });

  it("throws VendorNotFoundError for an unknown vendor", async () => {
    await expect(fixtureStore().findProfile("process", "Acme", "anything")).rejects.toBeInstanceOf(
      VendorNotFoundError
    );
  });
});

describe("FsProfileStore.writeUserPreset", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "ppm-store-"));
    await cp(join(FIXTURES, "userdata"), join(workDir, "userdata"), { recursive: true });
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function writableStore(): FsProfileStore {
    return new FsProfileStore({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(workDir, "userdata"),
    });
  }

  it("creates a new preset file and reports created: true", async () => {
    const result = await writableStore().writeUserPreset("process", "Fresh Preset", {
      name: "Fresh Preset",
      inherits: "fdm_process_common",
      wall_loops: ["4"],
    });
    expect(result.created).toBe(true);
    expect(result.path).toBe(join(workDir, "userdata", "user", "12345", "process", "Fresh Preset.json"));
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk.wall_loops).toEqual(["4"]);
  });

  it("overwrites an existing preset and reports created: false", async () => {
    const store = writableStore();
    const result = await store.writeUserPreset("process", "My Custom Draft", {
      name: "My Custom Draft",
      inherits: "fdm_process_common",
      layer_height: ["0.3"],
    });
    expect(result.created).toBe(false);
    const hit = await store.findProfile("process", "BBL", "My Custom Draft");
    expect(hit?.profile.layer_height).toEqual(["0.3"]);
  });

  it("throws UserStoreError when no user/<id> directory exists", async () => {
    await rm(join(workDir, "userdata", "user", "12345"), { recursive: true });
    await expect(
      writableStore().writeUserPreset("process", "X", { name: "X" })
    ).rejects.toBeInstanceOf(UserStoreError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profile-store.test.ts`
Expected: FAIL — cannot resolve `../src/profile-store.js`.

- [ ] **Step 3: Write `src/profile-store.ts`**

```typescript
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UserStoreError, VendorNotFoundError } from "./errors.js";
import type { ProfileHit, ProfileKind, ProfileStore, RawProfile, ServerConfig } from "./types.js";

async function scanDirForName(dir: string, name: string): Promise<{ profile: RawProfile; path: string } | null> {
  if (!existsSync(dir)) return null;
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue; // unreadable/non-JSON files are not candidates
    }
    const profile = parsed as RawProfile;
    if (profile && typeof profile === "object" && profile.name === name) {
      return { profile, path };
    }
  }
  return null;
}

export class FsProfileStore implements ProfileStore {
  constructor(private readonly cfg: ServerConfig) {}

  private async userKindDirs(kind: ProfileKind): Promise<string[]> {
    const userRoot = join(this.cfg.userDataDir, "user");
    if (!existsSync(userRoot)) return [];
    const ids = await readdir(userRoot, { withFileTypes: true });
    return ids.filter((d) => d.isDirectory()).map((d) => join(userRoot, d.name, kind));
  }

  async findProfile(kind: ProfileKind, vendor: string, name: string): Promise<ProfileHit | null> {
    for (const dir of await this.userKindDirs(kind)) {
      const found = await scanDirForName(dir, name);
      if (found) return { ...found, source: "user" };
    }
    const vendorDir = join(this.cfg.installDir, "resources", "profiles", vendor);
    if (!existsSync(vendorDir)) throw new VendorNotFoundError(vendor);
    const found = await scanDirForName(join(vendorDir, kind), name);
    return found ? { ...found, source: "system" } : null;
  }

  async writeUserPreset(
    kind: ProfileKind,
    name: string,
    body: Record<string, unknown>
  ): Promise<{ path: string; created: boolean }> {
    const userRoot = join(this.cfg.userDataDir, "user");
    if (!existsSync(userRoot)) throw new UserStoreError(`'${userRoot}' does not exist.`);
    const ids = (await readdir(userRoot, { withFileTypes: true })).filter((d) => d.isDirectory());
    if (ids.length === 0) throw new UserStoreError(`no user id directory under '${userRoot}'.`);
    if (ids.length > 1) {
      throw new UserStoreError(
        `multiple user id directories under '${userRoot}' (${ids.map((d) => d.name).join(", ")}); cannot pick a write target.`
      );
    }
    const dir = join(userRoot, ids[0].name, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${name}.json`);
    const created = !existsSync(path);
    await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
    return { path, created };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/profile-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/profile-store.ts tests/profile-store.test.ts
git commit -m "feat: filesystem profile store over system and user preset dirs"
```

---

### Task 4: Inheritance resolver

**Files:**
- Create: `src/resolver.ts`
- Test: `tests/resolver.test.ts`

**Interfaces:**
- Consumes: `ProfileStore`, `ProfileHit`, `ResolvedProfile`, `ProfileKind` types and `ProfileNotFoundError`, `CircularInheritanceError` from Task 1. Uses only the `ProfileStore` interface — NOT `FsProfileStore` — so this task runs in parallel with Task 3 using an in-memory fake.
- Produces: `function resolveProfile(store: ProfileStore, kind: ProfileKind, vendor: string, name: string): Promise<ResolvedProfile>`.

Merge semantics (locked): walk `inherits` links from the requested profile up to the root; `chain` lists names root-first, requested profile last. Merge by applying each chain link in `chain` order — later (more specific) keys overwrite earlier ones. `settings` excludes the `inherits` and `name` keys; everything else passes through untouched (array-wrapped values stay wrapped).

- [ ] **Step 1: Write the failing test `tests/resolver.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { CircularInheritanceError, ProfileNotFoundError } from "../src/errors.js";
import { resolveProfile } from "../src/resolver.js";
import type { ProfileHit, ProfileKind, ProfileStore, RawProfile } from "../src/types.js";

/** In-memory store; keys are profile names. */
function fakeStore(profiles: Record<string, RawProfile & { source?: "user" | "system" }>): ProfileStore {
  return {
    async findProfile(_kind: ProfileKind, _vendor: string, name: string): Promise<ProfileHit | null> {
      const p = profiles[name];
      if (!p) return null;
      const { source, ...profile } = p;
      return { profile, source: source ?? "system", path: `/fake/${name}.json` };
    },
    async writeUserPreset(): Promise<{ path: string; created: boolean }> {
      throw new Error("not used in resolver tests");
    },
  };
}

describe("resolveProfile", () => {
  it("merges a chain root-first with child keys overwriting parent keys", async () => {
    const store = fakeStore({
      root: { name: "root", layer_height: ["0.2"], wall_loops: ["2"] },
      child: { name: "child", inherits: "root", wall_loops: ["3"] },
    });
    const result = await resolveProfile(store, "process", "BBL", "child");
    expect(result.chain).toEqual(["root", "child"]);
    expect(result.settings).toEqual({ layer_height: ["0.2"], wall_loops: ["3"] });
    expect(result).toMatchObject({ vendor: "BBL", name: "child", kind: "process" });
  });

  it("crosses from a user preset into the system store", async () => {
    const store = fakeStore({
      sys_root: { name: "sys_root", nozzle_temperature: ["220"] },
      "My Filament": { name: "My Filament", inherits: "sys_root", source: "user", nozzle_temperature: ["205"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "My Filament");
    expect(result.chain).toEqual(["sys_root", "My Filament"]);
    expect(result.settings.nozzle_temperature).toEqual(["205"]);
  });

  it("excludes name and inherits from settings", async () => {
    const store = fakeStore({ solo: { name: "solo", layer_height: ["0.2"] } });
    const result = await resolveProfile(store, "process", "BBL", "solo");
    expect(result.settings).toEqual({ layer_height: ["0.2"] });
  });

  it("throws ProfileNotFoundError for a missing profile", async () => {
    await expect(resolveProfile(fakeStore({}), "process", "BBL", "ghost")).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });

  it("throws ProfileNotFoundError when a parent in the chain is missing", async () => {
    const store = fakeStore({ orphan: { name: "orphan", inherits: "does_not_exist" } });
    await expect(resolveProfile(store, "process", "BBL", "orphan")).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });

  it("throws CircularInheritanceError on a cycle", async () => {
    const store = fakeStore({
      a: { name: "a", inherits: "b" },
      b: { name: "b", inherits: "a" },
    });
    await expect(resolveProfile(store, "process", "BBL", "a")).rejects.toBeInstanceOf(
      CircularInheritanceError
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resolver.test.ts`
Expected: FAIL — cannot resolve `../src/resolver.js`.

- [ ] **Step 3: Write `src/resolver.ts`**

```typescript
import { CircularInheritanceError, ProfileNotFoundError } from "./errors.js";
import type { ProfileKind, ProfileStore, RawProfile, ResolvedProfile } from "./types.js";

export async function resolveProfile(
  store: ProfileStore,
  kind: ProfileKind,
  vendor: string,
  name: string
): Promise<ResolvedProfile> {
  const chainLeafFirst: RawProfile[] = [];
  const visited = new Set<string>();
  let current: string | undefined = name;

  while (current !== undefined) {
    if (visited.has(current)) {
      throw new CircularInheritanceError([...visited, current]);
    }
    visited.add(current);
    const hit = await store.findProfile(kind, vendor, current);
    if (!hit) throw new ProfileNotFoundError(kind, current);
    chainLeafFirst.push(hit.profile);
    current = hit.profile.inherits;
  }

  const chainRootFirst = [...chainLeafFirst].reverse();
  const settings: Record<string, unknown> = {};
  for (const profile of chainRootFirst) {
    for (const [key, value] of Object.entries(profile)) {
      if (key === "name" || key === "inherits") continue;
      settings[key] = value;
    }
  }

  return {
    vendor,
    name,
    kind,
    chain: chainRootFirst.map((p) => p.name),
    settings,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resolver.ts tests/resolver.test.ts
git commit -m "feat: inheritance-chain resolver with cycle and missing-parent detection"
```

---

### Task 5: Schema loader and kvps validator

**Files:**
- Create: `src/validator.ts`
- Test: `tests/validator.test.ts`

**Interfaces:**
- Consumes: `ProfileSchema`, `SchemaOption`, `Violation` types from Task 1.
- Produces:
  - `function loadSchema(path: string): Promise<ProfileSchema>` — reads and parses a schema JSON file; throws `Error` with the path in the message if the file is missing or invalid JSON.
  - `function validateKvps(schema: ProfileSchema, kvps: Record<string, unknown>): Violation[]` — pure; empty array means valid; collects ALL violations.

Value acceptance rules (locked): when `serializedAsArray` is true, accept either the bare value or a single-element array wrapping it (a multi-element array is a violation). After unwrapping: `int` accepts integers or strings matching `/^-?\d+$/`; `float` accepts finite numbers or strings parseable by `Number`; `percent` is like `float` but the string form may carry a trailing `%`; `bool` accepts booleans or `"1"`, `"0"`, `"true"`, `"false"`; `enum` accepts a string contained in `enum`; `string` accepts any string. `min`/`max` are checked on the parsed numeric value, inclusive.

- [ ] **Step 1: Write the failing test `tests/validator.test.ts`**

```typescript
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchema, validateKvps } from "../src/validator.js";
import type { ProfileSchema } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const schema: ProfileSchema = {
  layer_height: { type: "float", min: 0.04, max: 1.0, default: 0.2, serializedAsArray: true },
  wall_loops: { type: "int", min: 0, max: 1000, default: 2, serializedAsArray: true },
  enable_support: { type: "bool", default: false, serializedAsArray: true },
  wall_generator: { type: "enum", enum: ["classic", "arachne"], default: "classic", serializedAsArray: true },
  sparse_infill_density: { type: "percent", min: 0, max: 100, default: 15, serializedAsArray: true },
  notes: { type: "string", default: "", serializedAsArray: false },
};

describe("loadSchema", () => {
  it("loads the checked-in fixture schema", async () => {
    const loaded = await loadSchema(join(FIXTURES, "schema", "process.schema.json"));
    expect(loaded.layer_height.type).toBe("float");
  });

  it("names the path when the file is missing", async () => {
    await expect(loadSchema(join(FIXTURES, "schema", "nope.json"))).rejects.toThrow(/nope\.json/);
  });
});

describe("validateKvps", () => {
  it("accepts valid kvps in both bare and array-wrapped form", () => {
    expect(
      validateKvps(schema, {
        layer_height: ["0.28"],
        wall_loops: 3,
        enable_support: ["1"],
        wall_generator: "arachne",
        sparse_infill_density: ["25%"],
        notes: "hello",
      })
    ).toEqual([]);
  });

  it("rejects unknown keys", () => {
    const violations = validateKvps(schema, { bogus_key: ["1"] });
    expect(violations).toEqual([{ key: "bogus_key", reason: expect.stringContaining("unknown") }]);
  });

  it("rejects wrong types, out-of-range values, and bad enums — all collected", () => {
    const violations = validateKvps(schema, {
      layer_height: ["5.0"],
      wall_loops: ["2.5"],
      wall_generator: ["spiral"],
      enable_support: ["maybe"],
    });
    expect(violations.map((v) => v.key).sort()).toEqual([
      "enable_support",
      "layer_height",
      "wall_generator",
      "wall_loops",
    ]);
  });

  it("rejects multi-element arrays for scalar options", () => {
    const violations = validateKvps(schema, { layer_height: ["0.2", "0.3"] });
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("layer_height");
  });

  it("checks range bounds inclusively", () => {
    expect(validateKvps(schema, { layer_height: ["1.0"], wall_loops: [0] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validator.test.ts`
Expected: FAIL — cannot resolve `../src/validator.js`.

- [ ] **Step 3: Write `src/validator.ts`**

```typescript
import { readFile } from "node:fs/promises";
import type { ProfileSchema, SchemaOption, Violation } from "./types.js";

export async function loadSchema(path: string): Promise<ProfileSchema> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Schema file '${path}' not found. Run scripts/generate-schema to produce it.`);
  }
  try {
    return JSON.parse(raw) as ProfileSchema;
  } catch {
    throw new Error(`Schema file '${path}' is not valid JSON.`);
  }
}

/** Unwraps ["x"] to "x" when the option is array-serialized. Returns undefined on shape violation. */
function unwrap(option: SchemaOption, value: unknown): { value: unknown } | undefined {
  if (Array.isArray(value)) {
    if (!option.serializedAsArray || value.length !== 1) return undefined;
    return { value: value[0] };
  }
  return { value };
}

function parseNumeric(option: SchemaOption, value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = option.type === "percent" ? value.replace(/%$/, "") : value;
  if (option.type === "int" && !/^-?\d+$/.test(text)) return undefined;
  if (text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function checkValue(key: string, option: SchemaOption, raw: unknown): Violation | null {
  const unwrapped = unwrap(option, raw);
  if (!unwrapped) {
    return { key, reason: `expected a single ${option.type} value, got ${JSON.stringify(raw)}` };
  }
  const value = unwrapped.value;

  switch (option.type) {
    case "string":
      return typeof value === "string" ? null : { key, reason: `expected a string, got ${JSON.stringify(value)}` };
    case "enum": {
      const allowed = option.enum ?? [];
      return typeof value === "string" && allowed.includes(value)
        ? null
        : { key, reason: `expected one of [${allowed.join(", ")}], got ${JSON.stringify(value)}` };
    }
    case "bool": {
      const ok = typeof value === "boolean" || (typeof value === "string" && ["0", "1", "true", "false"].includes(value));
      return ok ? null : { key, reason: `expected a bool (true/false/"0"/"1"), got ${JSON.stringify(value)}` };
    }
    case "int":
    case "float":
    case "percent": {
      const parsed = parseNumeric(option, value);
      if (parsed === undefined) {
        return { key, reason: `expected ${option.type === "int" ? "an integer" : `a ${option.type}`}, got ${JSON.stringify(value)}` };
      }
      if (option.min !== undefined && parsed < option.min) {
        return { key, reason: `value ${parsed} is below minimum ${option.min}` };
      }
      if (option.max !== undefined && parsed > option.max) {
        return { key, reason: `value ${parsed} is above maximum ${option.max}` };
      }
      return null;
    }
  }
}

export function validateKvps(schema: ProfileSchema, kvps: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(kvps)) {
    const option = schema[key];
    if (!option) {
      violations.push({ key, reason: "unknown key (not present in the schema)" });
      continue;
    }
    const violation = checkValue(key, option, value);
    if (violation) violations.push(violation);
  }
  return violations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/validator.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/validator.ts tests/validator.test.ts
git commit -m "feat: schema loader and kvps validator with array-wrapped scalar support"
```

---

### Task 6: Offline schema generator script

**Files:**
- Create: `scripts/generate-schema/index.ts`, `scripts/generate-schema/parse.ts`
- Create: `tests/fixtures/cpp/print-config-snippet.cpp`
- Test: `tests/generate-schema.test.ts`

**Interfaces:**
- Consumes: `ProfileSchema`, `SchemaOption` types from Task 1.
- Produces: a CLI (`npx tsx scripts/generate-schema/index.ts <bambustudio-checkout-dir>`) that writes `schema/process.schema.json` and `schema/filament.schema.json`, plus the pure function `parsePrintConfig(cppSource: string): Record<string, SchemaOption & { assignedTo?: "process" | "filament" }>` used by the smoke test.

Per the spec, this task is smoke-test only: the parser is exercised against a small checked-in C++ fixture, not a real checkout. Running it against a real BambuStudio checkout is a manual step done later (Task 10 documents it); if the regexes below miss patterns in the real source, extend them then — do not block this task on it.

Parsing approach (locked): Bambu Studio defines options in `src/libslic3r/PrintConfig.cpp` as blocks like `def = this->add("layer_height", coFloat); ... def->min = 0; ... def->set_default_value(new ConfigOptionFloat(0.2));`. Extract per-block: key, `co*` type token, `def->min`/`def->max`, `def->enum_values`, and default. Map `coFloat|coFloats→float`, `coInt|coInts→int`, `coBool|coBools→bool`, `coString|coStrings→string`, `coEnum→enum`, `coPercent|coPercents→percent`; the plural (`co*s`) forms and all `coStrings` set `serializedAsArray: true`, and since Bambu also array-wraps singulars on disk, set `serializedAsArray: true` for ALL types except bare `coString`. Assignment to process vs filament comes from the option-key lists in `Preset::print_options()` and `Preset::filament_options()` in `src/slic3r/GUI/Preset.cpp` (fallback: `src/libslic3r/Preset.cpp`); keys in neither list are dropped.

- [ ] **Step 1: Write the C++ fixture `tests/fixtures/cpp/print-config-snippet.cpp`**

```cpp
// Trimmed, structurally faithful excerpt of PrintConfig.cpp definition blocks.
void PrintConfigDef::init_fff_params()
{
    ConfigOptionDef* def;

    def = this->add("layer_height", coFloat);
    def->label = L("Layer height");
    def->min = 0.04;
    def->max = 1.0;
    def->set_default_value(new ConfigOptionFloat(0.2));

    def = this->add("wall_loops", coInt);
    def->label = L("Wall loops");
    def->min = 0;
    def->set_default_value(new ConfigOptionInt(2));

    def = this->add("enable_support", coBool);
    def->label = L("Enable support");
    def->set_default_value(new ConfigOptionBool(false));

    def = this->add("wall_generator", coEnum);
    def->enum_values.push_back("classic");
    def->enum_values.push_back("arachne");
    def->set_default_value(new ConfigOptionEnum<PerimeterGeneratorType>(PerimeterGeneratorType::Classic));

    def = this->add("nozzle_temperature", coInts);
    def->label = L("Nozzle temperature");
    def->min = 0;
    def->max = 350;
    def->set_default_value(new ConfigOptionInts { 200 });
}
```

- [ ] **Step 2: Write the failing test `tests/generate-schema.test.ts`**

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePrintConfig } from "../scripts/generate-schema/parse.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "cpp", "print-config-snippet.cpp");

describe("parsePrintConfig (smoke test)", () => {
  it("extracts key, type, range, and enum values from definition blocks", async () => {
    const source = await readFile(FIXTURE, "utf8");
    const options = parsePrintConfig(source);

    expect(options.layer_height).toMatchObject({ type: "float", min: 0.04, max: 1.0, serializedAsArray: true });
    expect(options.wall_loops).toMatchObject({ type: "int", min: 0 });
    expect(options.enable_support).toMatchObject({ type: "bool" });
    expect(options.wall_generator).toMatchObject({ type: "enum", enum: ["classic", "arachne"] });
    expect(options.nozzle_temperature).toMatchObject({ type: "int", min: 0, max: 350, serializedAsArray: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/generate-schema.test.ts`
Expected: FAIL — cannot resolve `../scripts/generate-schema/parse.js`.

- [ ] **Step 4: Write `scripts/generate-schema/parse.ts`**

```typescript
import type { SchemaOption, SchemaType } from "../../src/types.js";

const TYPE_MAP: Record<string, SchemaType> = {
  coFloat: "float", coFloats: "float",
  coInt: "int", coInts: "int",
  coBool: "bool", coBools: "bool",
  coString: "string", coStrings: "string",
  coEnum: "enum",
  coPercent: "percent", coPercents: "percent",
};

export function parsePrintConfig(cppSource: string): Record<string, SchemaOption> {
  const options: Record<string, SchemaOption> = {};
  // Split into blocks starting at each `def = this->add("key", coType)` line.
  const blockRe = /def\s*=\s*this->add\("([^"]+)",\s*(co\w+)\)([\s\S]*?)(?=def\s*=\s*this->add\(|$)/g;
  for (const match of cppSource.matchAll(blockRe)) {
    const [, key, coType, body] = match;
    const type = TYPE_MAP[coType];
    if (!type) continue;

    const option: SchemaOption = {
      type,
      serializedAsArray: coType !== "coString",
    };
    const min = body.match(/def->min\s*=\s*(-?[\d.]+)/);
    if (min) option.min = Number(min[1]);
    const max = body.match(/def->max\s*=\s*(-?[\d.]+)/);
    if (max) option.max = Number(max[1]);
    if (type === "enum") {
      option.enum = [...body.matchAll(/enum_values\.push_back\("([^"]+)"\)/g)].map((m) => m[1]);
    }
    const def = body.match(/set_default_value\(new\s+ConfigOption\w+(?:<[^>]+>)?\s*[({]\s*([^)}]*?)\s*[)}]\)/);
    if (def && def[1] !== "") {
      const text = def[1];
      if (text === "true" || text === "false") option.default = text === "true";
      else if (/^-?[\d.]+$/.test(text)) option.default = Number(text);
      else option.default = text.replace(/^"|"$/g, "");
    }
    options[key] = option;
  }
  return options;
}

/** Extracts the quoted option keys from a `print_options()` / `filament_options()` list body. */
export function parseOptionList(cppSource: string, fnName: string): string[] {
  const fn = cppSource.match(new RegExp(`${fnName}\\s*\\(\\)[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`));
  if (!fn) return [];
  return [...fn[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/generate-schema.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Write the CLI `scripts/generate-schema/index.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>
 * Writes schema/process.schema.json and schema/filament.schema.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileSchema } from "../../src/types.js";
import { parseOptionList, parsePrintConfig } from "./parse.js";

const checkout = process.argv[2];
if (!checkout) {
  console.error("Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>");
  process.exit(1);
}

const printConfigPath = join(checkout, "src", "libslic3r", "PrintConfig.cpp");
if (!existsSync(printConfigPath)) {
  console.error(`Not a BambuStudio checkout: '${printConfigPath}' not found.`);
  process.exit(1);
}

const presetCandidates = [
  join(checkout, "src", "slic3r", "GUI", "Preset.cpp"),
  join(checkout, "src", "libslic3r", "Preset.cpp"),
];
const presetPath = presetCandidates.find((p) => existsSync(p));
if (!presetPath) {
  console.error(`Preset.cpp not found in: ${presetCandidates.join(", ")}`);
  process.exit(1);
}

const allOptions = parsePrintConfig(await readFile(printConfigPath, "utf8"));
const presetSource = await readFile(presetPath, "utf8");
const processKeys = new Set(parseOptionList(presetSource, "print_options"));
const filamentKeys = new Set(parseOptionList(presetSource, "filament_options"));

function pick(keys: Set<string>): ProfileSchema {
  const out: ProfileSchema = {};
  for (const [key, option] of Object.entries(allOptions)) {
    if (keys.has(key)) out[key] = option;
  }
  return out;
}

const processSchema = pick(processKeys);
const filamentSchema = pick(filamentKeys);
if (Object.keys(processSchema).length === 0 || Object.keys(filamentSchema).length === 0) {
  console.error(
    `Parsed ${Object.keys(allOptions).length} options but matched ` +
      `${Object.keys(processSchema).length} process / ${Object.keys(filamentSchema).length} filament keys. ` +
      `The option-list parsing likely needs adjusting for this checkout — inspect ${presetPath}.`
  );
  process.exit(1);
}

await mkdir("schema", { recursive: true });
await writeFile(join("schema", "process.schema.json"), JSON.stringify(processSchema, null, 2) + "\n");
await writeFile(join("schema", "filament.schema.json"), JSON.stringify(filamentSchema, null, 2) + "\n");
console.log(
  `Wrote schema/process.schema.json (${Object.keys(processSchema).length} keys) and ` +
    `schema/filament.schema.json (${Object.keys(filamentSchema).length} keys).`
);
```

- [ ] **Step 7: Verify everything still builds and passes**

Run: `npm run build && npm test`
Expected: build succeeds (note: `scripts/` is outside `tsconfig` `include`, which is intended — it runs via tsx); all tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/ tests/fixtures/cpp/ tests/generate-schema.test.ts
git commit -m "feat: offline schema generator parsing BambuStudio PrintConfig.cpp"
```

---

### Task 7: Resolve tools (process + filament)

**Files:**
- Create: `src/tools/deps.ts`, `src/tools/resolve.ts`
- Test: `tests/tools-resolve.test.ts`

**Interfaces:**
- Consumes: `ConfigManager` (Task 2), `FsProfileStore` (Task 3), `resolveProfile` (Task 4), types/errors (Task 1).
- Produces:
  - `interface ToolDeps { config: ConfigManager; storeFactory: (cfg: ServerConfig) => ProfileStore; schemaDir: string; }` (in `src/tools/deps.ts` — Task 8 and 9 import this exact interface).
  - `function handleResolve(deps: ToolDeps, kind: ProfileKind, args: { vendor: string; name: string }): Promise<ResolvedProfile>`
  - `function registerResolveTools(server: McpServer, deps: ToolDeps): void` — registers `resolve_process_profile` and `resolve_filament_profile`.
  - `function toToolError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true }` (also in `deps.ts`, shared by Tasks 8/9): maps a thrown error to an MCP error result whose text is `Error: <error.message>`.

- [ ] **Step 1: Write the failing test `tests/tools-resolve.test.ts`**

```typescript
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ConfigMissingError, ProfileNotFoundError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import { toToolError, type ToolDeps } from "../src/tools/deps.js";
import { handleResolve } from "../src/tools/resolve.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function fixtureDeps(): ToolDeps {
  return {
    config: new ConfigManager(join(FIXTURES, "no-config.json"), () => ({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
    })),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
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
    expect(result.settings.wall_loops).toEqual(["3"]);
    expect(result.settings.layer_height).toEqual(["0.2"]);
  });

  it("resolves a user preset crossing into the system store", async () => {
    const result = await handleResolve(fixtureDeps(), "process", {
      vendor: "BBL",
      name: "My Custom Draft",
    });
    expect(result.chain).toEqual(["fdm_process_common", "0.20mm Standard @BBL X1C", "My Custom Draft"]);
    expect(result.settings.layer_height).toEqual(["0.28"]);
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
    const deps: ToolDeps = { ...fixtureDeps(), config: new ConfigManager(join(FIXTURES, "no-config.json"), () => null) };
    await expect(
      handleResolve(deps, "process", { vendor: "BBL", name: "anything" })
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools-resolve.test.ts`
Expected: FAIL — cannot resolve `../src/tools/deps.js`.

- [ ] **Step 3: Write `src/tools/deps.ts`**

```typescript
import type { ConfigManager } from "../config.js";
import type { ProfileStore, ServerConfig } from "../types.js";

export interface ToolDeps {
  config: ConfigManager;
  storeFactory: (cfg: ServerConfig) => ProfileStore;
  /** Directory containing process.schema.json and filament.schema.json. */
  schemaDir: string;
}

export function toToolError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
```

- [ ] **Step 4: Write `src/tools/resolve.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveProfile } from "../resolver.js";
import type { ProfileKind, ResolvedProfile } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleResolve(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; name: string }
): Promise<ResolvedProfile> {
  const cfg = await deps.config.require();
  const store = deps.storeFactory(cfg);
  return resolveProfile(store, kind, args.vendor, args.name);
}

const resolveInputShape = {
  vendor: z.string().min(1).describe("Vendor folder under resources/profiles, e.g. 'BBL'"),
  name: z.string().min(1).describe("Profile name (the 'name' field inside the profile JSON)"),
};

function register(server: McpServer, deps: ToolDeps, kind: ProfileKind): void {
  server.registerTool(
    `resolve_${kind}_profile`,
    {
      title: `Resolve ${kind} profile`,
      description:
        `Resolve a Bambu Studio ${kind} profile's fully-merged active settings by walking its ` +
        `'inherits' chain across the user preset store and the system profiles of the given vendor.\n\n` +
        `Args:\n  - vendor (string): vendor folder under resources/profiles, e.g. 'BBL'\n` +
        `  - name (string): profile name as shown in the profile JSON 'name' field\n\n` +
        `Returns: { vendor, name, kind, chain: string[] (root-first), settings: object (flat merged key->value map) }\n\n` +
        `Errors: vendor not found; profile not found; circular or unresolvable inherits chain; ` +
        `paths not configured (fix via init_config).`,
      inputSchema: resolveInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { vendor: string; name: string }) => {
      try {
        const result = await handleResolve(deps, kind, args);
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

export function registerResolveTools(server: McpServer, deps: ToolDeps): void {
  register(server, deps, "process");
  register(server, deps, "filament");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tools-resolve.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/tools/ tests/tools-resolve.test.ts
git commit -m "feat: resolve_process_profile and resolve_filament_profile tools"
```

---

### Task 8: Write tools (process + filament)

**Files:**
- Create: `src/tools/write.ts`
- Test: `tests/tools-write.test.ts`

**Interfaces:**
- Consumes: `ToolDeps`/`toToolError` (Task 7's `src/tools/deps.ts`), `resolveProfile` (Task 4), `loadSchema`/`validateKvps` (Task 5), `FsProfileStore` (Task 3), types/errors (Task 1). If Task 7 has not landed yet, create `src/tools/deps.ts` with the exact content shown in Task 7 Step 3 — first writer wins, content is identical.
- Produces:
  - `interface WriteResult { vendor: string; name: string; kind: ProfileKind; created: boolean; path: string; inherits: string; overrides: Record<string, unknown>; }`
  - `function handleWrite(deps: ToolDeps, kind: ProfileKind, args: { vendor: string; name: string; baseProfile: string; kvps: Record<string, unknown> }): Promise<WriteResult>`
  - `function registerWriteTools(server: McpServer, deps: ToolDeps): void` — registers `write_process_profile` and `write_filament_profile`.

Behavior (locked): validate ALL kvps against `<schemaDir>/<kind>.schema.json` first (violations → `SchemaValidationError`); then resolve `baseProfile` via `resolveProfile` (proves it exists and its chain is sound) BEFORE writing anything; then write `{ name, inherits: baseProfile, ...kvps }` to the user store. Nothing is written if any check fails.

- [ ] **Step 1: Write the failing test `tests/tools-write.test.ts`**

```typescript
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { ProfileNotFoundError, SchemaValidationError } from "../src/errors.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleWrite } from "../src/tools/write.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ppm-write-"));
  await cp(join(FIXTURES, "userdata"), join(workDir, "userdata"), { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function deps(): ToolDeps {
  return {
    config: new ConfigManager(join(workDir, "no-config.json"), () => ({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(workDir, "userdata"),
    })),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
  };
}

describe("handleWrite", () => {
  it("creates a new preset with inherits and only the given kvps", async () => {
    const result = await handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "Plan Test Preset",
      baseProfile: "0.20mm Standard @BBL X1C",
      kvps: { layer_height: ["0.16"], wall_loops: 4 },
    });
    expect(result).toMatchObject({
      vendor: "BBL",
      name: "Plan Test Preset",
      kind: "process",
      created: true,
      inherits: "0.20mm Standard @BBL X1C",
      overrides: { layer_height: ["0.16"], wall_loops: 4 },
    });
    const onDisk = JSON.parse(await readFile(result.path, "utf8"));
    expect(onDisk).toEqual({
      name: "Plan Test Preset",
      inherits: "0.20mm Standard @BBL X1C",
      layer_height: ["0.16"],
      wall_loops: 4,
    });
  });

  it("overwrites an existing preset with created: false", async () => {
    const result = await handleWrite(deps(), "process", {
      vendor: "BBL",
      name: "My Custom Draft",
      baseProfile: "fdm_process_common",
      kvps: { layer_height: ["0.3"] },
    });
    expect(result.created).toBe(false);
  });

  it("collects ALL schema violations and writes nothing", async () => {
    const d = deps();
    const promise = handleWrite(d, "process", {
      vendor: "BBL",
      name: "Broken Preset",
      baseProfile: "fdm_process_common",
      kvps: { layer_height: ["5.0"], bogus_key: ["1"] },
    });
    await expect(promise).rejects.toBeInstanceOf(SchemaValidationError);
    const err = (await promise.catch((e: unknown) => e)) as SchemaValidationError;
    expect(err.violations.map((v) => v.key).sort()).toEqual(["bogus_key", "layer_height"]);
    expect(existsSync(join(workDir, "userdata", "user", "12345", "process", "Broken Preset.json"))).toBe(false);
  });

  it("rejects a missing baseProfile and writes nothing", async () => {
    await expect(
      handleWrite(deps(), "process", {
        vendor: "BBL",
        name: "Orphaned Preset",
        baseProfile: "ghost_base",
        kvps: { wall_loops: ["3"] },
      })
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect(existsSync(join(workDir, "userdata", "user", "12345", "process", "Orphaned Preset.json"))).toBe(false);
  });

  it("validates filament writes against the filament schema", async () => {
    await expect(
      handleWrite(deps(), "filament", {
        vendor: "BBL",
        name: "Hot PLA",
        baseProfile: "Generic PLA @BBL X1C",
        kvps: { nozzle_temperature: ["999"] },
      })
    ).rejects.toBeInstanceOf(SchemaValidationError);

    const ok = await handleWrite(deps(), "filament", {
      vendor: "BBL",
      name: "Hot PLA",
      baseProfile: "Generic PLA @BBL X1C",
      kvps: { nozzle_temperature: ["230"] },
    });
    expect(ok.kind).toBe("filament");
    expect(ok.created).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools-write.test.ts`
Expected: FAIL — cannot resolve `../src/tools/write.js` (or `deps.js` if Task 7 hasn't landed — then create `deps.ts` per Task 7 Step 3 first).

- [ ] **Step 3: Write `src/tools/write.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { resolveProfile } from "../resolver.js";
import type { ProfileKind } from "../types.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface WriteResult {
  vendor: string;
  name: string;
  kind: ProfileKind;
  created: boolean;
  path: string;
  inherits: string;
  overrides: Record<string, unknown>;
}

export async function handleWrite(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; name: string; baseProfile: string; kvps: Record<string, unknown> }
): Promise<WriteResult> {
  const cfg = await deps.config.require();
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const violations = validateKvps(schema, args.kvps);
  if (violations.length > 0) throw new SchemaValidationError(violations);

  const store = deps.storeFactory(cfg);
  await resolveProfile(store, kind, args.vendor, args.baseProfile);

  const body = { name: args.name, inherits: args.baseProfile, ...args.kvps };
  const { path, created } = await store.writeUserPreset(kind, args.name, body);
  return {
    vendor: args.vendor,
    name: args.name,
    kind,
    created,
    path,
    inherits: args.baseProfile,
    overrides: args.kvps,
  };
}

const writeInputShape = {
  vendor: z.string().min(1).describe("Vendor folder under resources/profiles, e.g. 'BBL'"),
  name: z.string().min(1).describe("Name of the preset to create or overwrite in the user store"),
  baseProfile: z.string().min(1).describe("Existing profile this preset will inherit from"),
  kvps: z
    .record(z.unknown())
    .describe("Only the keys to override; each is validated against the schema before writing"),
};

function register(server: McpServer, deps: ToolDeps, kind: ProfileKind): void {
  server.registerTool(
    `write_${kind}_profile`,
    {
      title: `Write ${kind} profile`,
      description:
        `Create or update a Bambu Studio ${kind} preset in the user store. The preset inherits from ` +
        `baseProfile and contains ONLY the kvps overrides. Every kvps key and value is validated ` +
        `against schema/${kind}.schema.json before anything is written; all violations are reported together.\n\n` +
        `Args:\n  - vendor (string), name (string), baseProfile (string), kvps (object of key->value overrides)\n\n` +
        `Returns: { vendor, name, kind, created, path, inherits, overrides }\n\n` +
        `Errors: baseProfile not found or unresolvable; schema violations listed per key; ` +
        `paths not configured (fix via init_config).`,
      inputSchema: writeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: { vendor: string; name: string; baseProfile: string; kvps: Record<string, unknown> }) => {
      try {
        const result = await handleWrite(deps, kind, args);
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

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  register(server, deps, "process");
  register(server, deps, "filament");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools-write.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the whole suite and the build**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/write.ts tests/tools-write.test.ts
git commit -m "feat: write_process_profile and write_filament_profile tools"
```

---

### Task 9: init_config tool

**Files:**
- Create: `src/tools/init-config.ts`
- Test: `tests/tools-init-config.test.ts`

**Interfaces:**
- Consumes: `ToolDeps`/`toToolError` (Task 7's `src/tools/deps.ts` — same first-writer-wins rule as Task 8), `ConfigManager`/`validateConfigPaths` (Task 2).
- Produces:
  - `function handleInitConfig(deps: ToolDeps, args: { installDir: string; userDataDir: string }): Promise<{ installDir: string; userDataDir: string; persistedTo: string }>`
  - `function registerInitConfigTool(server: McpServer, deps: ToolDeps): void` — registers `init_config`.

Behavior (locked): validate both paths via `validateConfigPaths`; any problem → throw `Error` whose message joins all problems with newlines (nothing persisted). On success, `ConfigManager.save` persists `config.json` — and because `load()` prefers the file over auto-detection, subsequent tool calls in the same server process pick it up with no restart.

- [ ] **Step 1: Write the failing test `tests/tools-init-config.test.ts`**

```typescript
import { mkdtemp, rm } from "node:fs/promises";
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

function deps(): ToolDeps {
  return {
    config: new ConfigManager(join(dir, "config.json"), () => null),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
  };
}

describe("handleInitConfig", () => {
  it("persists valid paths and makes them available to load() immediately", async () => {
    const d = deps();
    const result = await handleInitConfig(d, {
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
    });
    expect(result.persistedTo).toBe(join(dir, "config.json"));
    expect(await d.config.load()).toEqual({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
    });
  });

  it("rejects invalid paths with all problems listed and persists nothing", async () => {
    const d = deps();
    const promise = handleInitConfig(d, { installDir: dir, userDataDir: dir });
    await expect(promise).rejects.toThrow(/resources/);
    await expect(promise).rejects.toThrow(/user/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools-init-config.test.ts`
Expected: FAIL — cannot resolve `../src/tools/init-config.js`.

- [ ] **Step 3: Write `src/tools/init-config.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateConfigPaths } from "../config.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleInitConfig(
  deps: ToolDeps,
  args: { installDir: string; userDataDir: string }
): Promise<{ installDir: string; userDataDir: string; persistedTo: string }> {
  const problems = await validateConfigPaths(args);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const persistedTo = await deps.config.save(args);
  return { ...args, persistedTo };
}

const initConfigInputShape = {
  installDir: z.string().min(1).describe("Bambu Studio install dir containing resources/profiles"),
  userDataDir: z.string().min(1).describe("Bambu Studio user-data dir containing the user/ preset store"),
};

export function registerInitConfigTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "init_config",
    {
      title: "Initialize path configuration",
      description:
        `Set and persist the Bambu Studio installDir and userDataDir used by all other tools. ` +
        `Call this when resolve/write tools report that paths are not configured, or to override auto-detection. ` +
        `Takes effect immediately — no server restart needed.\n\n` +
        `Args:\n  - installDir (string): must contain resources/profiles\n` +
        `  - userDataDir (string): must contain the user/ preset store\n\n` +
        `Returns: { installDir, userDataDir, persistedTo }\n\n` +
        `Errors: each invalid path is reported; nothing is persisted on failure.`,
      inputSchema: initConfigInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { installDir: string; userDataDir: string }) => {
      try {
        const result = await handleInitConfig(deps, args);
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

Run: `npx vitest run tests/tools-init-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/init-config.ts tests/tools-init-config.test.ts
git commit -m "feat: init_config tool with path validation and immediate persistence"
```

---

### Task 10: Server entry point, integration test, README

**Files:**
- Create: `src/index.ts`
- Modify: `README.md`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 7, 8, 9.
- Produces: `function buildServer(deps: ToolDeps): McpServer` (exported for tests) and the stdio entry point.

- [ ] **Step 1: Write the failing integration test `tests/server.test.ts`**

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { buildServer } from "../src/index.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function fixtureDeps(): ToolDeps {
  return {
    config: new ConfigManager(join(FIXTURES, "no-config.json"), () => ({
      installDir: join(FIXTURES, "install"),
      userDataDir: join(FIXTURES, "userdata"),
    })),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
  };
}

async function connectedClient(): Promise<Client> {
  const server = buildServer(fixtureDeps());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("printing-profile-mcp server", () => {
  it("exposes exactly the five spec tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "init_config",
      "resolve_filament_profile",
      "resolve_process_profile",
      "write_filament_profile",
      "write_process_profile",
    ]);
  });

  it("serves resolve_process_profile end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_process_profile",
      arguments: { vendor: "BBL", name: "0.20mm Standard @BBL X1C" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "process",
      chain: ["fdm_process_common", "0.20mm Standard @BBL X1C"],
    });
  });

  it("returns an isError result (not a protocol error) for a missing profile", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_process_profile",
      arguments: { vendor: "BBL", name: "ghost" },
    });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL — `buildServer` not exported from `../src/index.js`.

- [ ] **Step 3: Write `src/index.ts`**

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager } from "./config.js";
import { FsProfileStore } from "./profile-store.js";
import { type ToolDeps } from "./tools/deps.js";
import { registerInitConfigTool } from "./tools/init-config.js";
import { registerResolveTools } from "./tools/resolve.js";
import { registerWriteTools } from "./tools/write.js";

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "printing-profile-mcp", version: "0.1.0" });
  registerResolveTools(server, deps);
  registerWriteTools(server, deps);
  registerInitConfigTool(server, deps);
  return server;
}

async function main(): Promise<void> {
  // Project root = one level above dist/ (this file compiles to dist/index.js).
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const deps: ToolDeps = {
    config: new ConfigManager(join(projectRoot, "config.json")),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(projectRoot, "schema"),
  };
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  console.error("printing-profile-mcp running on stdio");
}

// Only start the transport when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full verification**

Run: `npm run build && npm test`
Expected: build succeeds; every test file passes.

- [ ] **Step 6: Replace `README.md` content**

```markdown
# printing-profile-mcp

An MCP (Model Context Protocol) server for managing 3D printing slicer profiles, currently targeting Bambu Studio.

## Tools

- `resolve_process_profile` / `resolve_filament_profile` — resolve a profile's fully-merged active settings by walking its `inherits` chain across the user preset store and system profiles.
- `write_process_profile` / `write_filament_profile` — create or update a user preset from a base profile plus schema-validated key-value overrides.
- `init_config` — set and persist the Bambu Studio `installDir`/`userDataDir` when auto-detection fails.

## Setup (Windows)

```powershell
npm install
npm run build
```

Generate the option schemas once from a local BambuStudio source checkout (re-run after Bambu Studio updates):

```powershell
npx tsx scripts/generate-schema/index.ts C:\path\to\BambuStudio
```

Register with Claude Code:

```powershell
claude mcp add printing-profiles -- node <checkout>\dist\index.js
```

Paths are auto-detected on first use; if that fails, call the `init_config` tool with your Bambu Studio install and user-data directories. They persist in `config.json` (gitignored, machine-specific).

## Development

```powershell
npm test
```

## License

Private / unlicensed.
```

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/server.test.ts README.md
git commit -m "feat: stdio server entry point wiring all five tools"
```

- [ ] **Step 8: Manual verification note (not automatable in-repo)**

Running `scripts/generate-schema` against a real BambuStudio checkout and smoke-calling the tools against a real Bambu Studio installation is a post-plan manual step for the user's machine (needs the checkout path and an actual install). Report this as the remaining open item when handing the branch back — do not silently skip it, and do not attempt to download the BambuStudio source yourself.

---

## Self-Review Notes

- Spec coverage: data sources (Tasks 3, 6), schema + array-wrapped scalars (Tasks 5, 6), path configuration ladder (Tasks 2, 9), all five tool contracts (Tasks 7–9), error handling (Tasks 1, 5, 7–9), testing requirements including the user→system chain crossing (Tasks 4, 7) and generator smoke test (Task 6), tech stack (Task 1). `profiles_template` exists as a fixture only — the spec assigns it no tool behavior, so no task consumes it.
- Interface names cross-checked: `ToolDeps`, `toToolError`, `handleResolve`, `handleWrite`, `handleInitConfig`, `buildServer`, `FsProfileStore`, `resolveProfile`, `loadSchema`, `validateKvps`, `ConfigManager`, `validateConfigPaths` are used with identical signatures everywhere they appear.
