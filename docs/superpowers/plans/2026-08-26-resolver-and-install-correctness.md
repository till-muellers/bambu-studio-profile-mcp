# Resolver and Install Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server agree with Bambu Studio on five points where it currently reports success while being wrong: the version an installed preset carries, `include` expansion, per-extruder column counts, keys Studio always rewrites, and whether an installed preset loads at all.

**Architecture:** Two new leaf modules carry the new facts — `src/versions.ts` for preset-version normalization, vendor-bundle lookup and the loadability predicate, and a generalized `BambuStudio.conf` reader in `src/config.ts` for the application version. The resolver expands `include` inside `loadChain`, so every tool built on it is fixed at once. The schema generator emits a `perVariant` flag per option, which the linter's column-count check consumes instead of applying the machine's column count to every vector.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, `@modelcontextprotocol/sdk`, zod.

**Spec:** `docs/superpowers/specs/2026-08-26-resolver-and-install-correctness-design.md`

## Global Constraints

- All user-facing strings (tool descriptions, `.describe` texts, error messages, violation reasons, warnings, finding details, notes) live in `src/strings.ts`. Never inline a user-facing literal elsewhere in `src/`.
- Tool descriptions follow Purpose / Returns / Errors / cross-tool pointers; parameter detail belongs only in zod `.describe` texts; no negations, no roadmap commentary.
- `schema/*.schema.json` are generated. Never hand-edit them. Facts come from the parser; descriptions come from `schema/descriptions.json` only.
- `src/types.ts` and `src/errors.ts` are locked contracts — additive changes only.
- `ReadableProfileKind` (process, filament, machine) and `WritableProfileKind` (process, filament) are separate literal unions; neither derives from the other.
- Bambu Studio directories are read-only for every tool except `import_profile` and `remove_profile`.
- Tests never write into `tests/fixtures/`; writable stores are `mkdtemp` temp dirs.
- Every changed tool result shape gets a protocol-level assertion in `tests/server.test.ts`.
- Never count tests, rules, files or tools in prose or documentation.
- `main` is protected. All work lands on the branch `fix/resolver-and-install-correctness` via PR with the `ci` check green.
- Run `npm test` before every commit.
- The BambuStudio source checkout is at `D:\repos\BambuStudio`, tag `v02.08.02.61`.

---

### Task 1: Application version from BambuStudio.conf

`src/config.ts` reads `BambuStudio.conf` for `app.preset_folder`. Generalize that reader so the same parse also yields `app.version`, which Bambu Studio writes as `SLIC3R_VERSION` on every startup (`GUI_App.cpp:3246`) — the exact constant its preset-load major check compares against.

**Files:**
- Modify: `src/config.ts:72-91` (`readPresetFolder`)
- Modify: `tests/fixtures/userdata/BambuStudio.conf`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `readAppSection(userDataDir: string): Promise<Record<string, unknown> | undefined>`
  - `readPresetFolder(userDataDir: string): Promise<string | undefined>` (signature unchanged)
  - `readAppVersion(userDataDir: string): Promise<string | undefined>`

- [ ] **Step 1: Add `version` to the conf fixture**

`tests/fixtures/userdata/BambuStudio.conf` — keep the trailing MD5 line, it is what the slice-parse exists for:

```
{
  "app": {
    "preset_folder": "1234567890",
    "version": "02.08.02.60"
  }
}
# MD5 checksum A5A1EEB155B489F5EB0071F673D67B5F
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/config.test.ts`:

```typescript
describe("readAppVersion", () => {
  it("reads app.version from a conf carrying the MD5 trailer", async () => {
    expect(await readAppVersion(join(FIXTURES, "userdata"))).toBe("02.08.02.60");
  });

  it("returns undefined when the conf has no app.version", async () => {
    await writeFile(
      join(dir, "BambuStudio.conf"),
      '{"app":{"preset_folder":"x"}}\n# MD5 checksum DEADBEEF\n',
      "utf8"
    );
    expect(await readAppVersion(dir)).toBeUndefined();
  });

  it("returns undefined when the conf is absent", async () => {
    expect(await readAppVersion(dir)).toBeUndefined();
  });

  it("returns undefined when the conf is not parseable", async () => {
    await writeFile(join(dir, "BambuStudio.conf"), "{not json\n", "utf8");
    expect(await readAppVersion(dir)).toBeUndefined();
  });
});

describe("readPresetFolder", () => {
  it("still reads app.preset_folder", async () => {
    expect(await readPresetFolder(join(FIXTURES, "userdata"))).toBe("1234567890");
  });
});
```

Extend the import at the top of the file to `import { ConfigManager, readAppVersion, readPresetFolder, resolveConfigDir, validateConfigPaths } from "../src/config.js";`

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `readAppVersion is not a function`.

- [ ] **Step 4: Generalize the reader**

Replace `readPresetFolder` in `src/config.ts` with:

```typescript
/**
 * Best-effort read of BambuStudio.conf's `app` object. Never throws. The file is JSON followed by a
 * non-JSON trailer line (a "# MD5 checksum ..." comment), so the content is trimmed to the outermost
 * {...} span before parsing; a leading BOM is stripped as well.
 */
export async function readAppSection(
  userDataDir: string
): Promise<Record<string, unknown> | undefined> {
  const confPath = join(userDataDir, "BambuStudio.conf");
  if (!existsSync(confPath)) return undefined;
  try {
    let text = await readFile(confPath, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return undefined;
    const raw: unknown = JSON.parse(text.slice(start, end + 1));
    const app = (raw as { app?: unknown })?.app;
    if (typeof app !== "object" || app === null || Array.isArray(app)) return undefined;
    return app as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function appString(app: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = app?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The logged-in account's preset folder name (BambuStudio.conf's app.preset_folder). */
export async function readPresetFolder(userDataDir: string): Promise<string | undefined> {
  return appString(await readAppSection(userDataDir), "preset_folder");
}

/**
 * The version of the Bambu Studio application that last ran: BambuStudio.conf's app.version, which
 * Studio writes as SLIC3R_VERSION on every startup. One release stale between an update and the
 * next launch.
 */
export async function readAppVersion(userDataDir: string): Promise<string | undefined> {
  return appString(await readAppSection(userDataDir), "version");
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts tests/fixtures/userdata/BambuStudio.conf
git commit -m "feat: read app.version from BambuStudio.conf"
```

---

### Task 2: Preset version facts

A leaf module holding what a preset's `version` means: how a Bambu version string normalizes to the Semver form Studio stores, where the vendor bundle version comes from, and whether Studio loads a preset carrying a given version.

**Files:**
- Create: `src/versions.ts`
- Modify: `src/strings.ts`
- Modify: `tests/fixtures/install/resources/profiles/BBL.json`
- Test: `tests/versions.test.ts` (create)

**Interfaces:**
- Consumes: `readAppVersion` from Task 1 (used by callers, not by this module).
- Produces:
  - `FALLBACK_PRESET_VERSION: "0.0.0"`
  - `normalizeVersion(raw: unknown): string | undefined`
  - `readVendorVersion(cfg: ServerConfig, vendor: string): Promise<string | undefined>`
  - `interface Loadability { ok: boolean; reason?: string; appVersionChecked: boolean }`
  - `evaluateLoadability(presetVersion: unknown, appVersion: string | undefined): Loadability`

- [ ] **Step 1: Add the version to the vendor index fixture**

`tests/fixtures/install/resources/profiles/BBL.json` — the padded form is what Bambu ships:

```json
{
  "name": "Bambulab",
  "version": "02.08.00.04"
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/versions.test.ts`:

```typescript
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateLoadability,
  normalizeVersion,
  readVendorVersion,
  FALLBACK_PRESET_VERSION,
} from "../src/versions.js";
import type { ServerConfig } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const CFG: ServerConfig = {
  installDir: join(FIXTURES, "install"),
  userDataDir: join(FIXTURES, "userdata"),
  userId: "1234567890",
};

describe("normalizeVersion", () => {
  it("strips leading zeros per component", () => {
    expect(normalizeVersion("02.08.00.04")).toBe("2.8.0.4");
  });

  it("leaves an already normalized version alone", () => {
    expect(normalizeVersion("2.7.0.8")).toBe("2.7.0.8");
  });

  it("accepts three components", () => {
    expect(normalizeVersion("0.0.0")).toBe("0.0.0");
  });

  it("rejects an empty string, a non-numeric component, and a non-string", () => {
    expect(normalizeVersion("")).toBeUndefined();
    expect(normalizeVersion("2.8.x")).toBeUndefined();
    expect(normalizeVersion("1.2")).toBeUndefined();
    expect(normalizeVersion(undefined)).toBeUndefined();
    expect(normalizeVersion(2)).toBeUndefined();
  });
});

describe("readVendorVersion", () => {
  it("reads and normalizes the vendor index version", async () => {
    expect(await readVendorVersion(CFG, "BBL")).toBe("2.8.0.4");
  });

  it("returns undefined for a vendor index that does not exist", async () => {
    expect(await readVendorVersion(CFG, "NOSUCHVENDOR")).toBeUndefined();
  });

  it("returns undefined for a vendor index carrying no version", async () => {
    expect(await readVendorVersion(CFG, "OTHERCO")).toBeUndefined();
  });
});

describe("evaluateLoadability", () => {
  it("rejects a missing version and says the app version was not consulted", () => {
    const result = evaluateLoadability(undefined, "02.08.02.60");
    expect(result.ok).toBe(false);
    expect(result.appVersionChecked).toBe(false);
    expect(result.reason).toBeTypeOf("string");
  });

  it("rejects an unparseable version", () => {
    expect(evaluateLoadability("", "02.08.02.60").ok).toBe(false);
  });

  it("accepts a version whose major matches the application", () => {
    expect(evaluateLoadability("2.8.0.4", "02.08.02.60")).toEqual({
      ok: true,
      appVersionChecked: true,
    });
  });

  it("rejects a version a major ahead of the application", () => {
    const result = evaluateLoadability("3.0.0.0", "02.08.02.60");
    expect(result.ok).toBe(false);
    expect(result.appVersionChecked).toBe(true);
  });

  it("accepts the fallback version against any application version", () => {
    expect(evaluateLoadability(FALLBACK_PRESET_VERSION, "02.08.02.60").ok).toBe(true);
  });

  it("skips the major condition when the application version is unknown", () => {
    expect(evaluateLoadability("99.0.0.0", undefined)).toEqual({
      ok: true,
      appVersionChecked: false,
    });
  });
});
```

Note: `tests/fixtures/install/resources/profiles/OTHERCO` exists as a directory; the test for a version-less index relies on there being no `OTHERCO.json`, which is the current fixture state. Verify with `ls tests/fixtures/install/resources/profiles` before running, and if an `OTHERCO.json` exists, point that test at a name that has no index file instead.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/versions.test.ts`
Expected: FAIL — cannot resolve `../src/versions.js`.

- [ ] **Step 4: Add the strings**

In `src/strings.ts`, inside the `messages` object, next to the other import/preset messages:

```typescript
    // Source: src/versions.ts evaluateLoadability
    versionMissingOrUnparseable: (value: unknown): string =>
      `carries no parseable version (${JSON.stringify(value)}); Bambu Studio skips such a preset silently.`,
    versionMajorAhead: (presetVersion: string, appVersion: string): string =>
      `version ${presetVersion} is a major version ahead of Bambu Studio ${appVersion}; Bambu Studio skips the preset.`,
```

- [ ] **Step 5: Write the module**

Create `src/versions.ts`:

```typescript
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strings } from "./strings.js";
import type { ServerConfig } from "./types.js";

/**
 * Version an install writes when the vendor index supplies none. Its major can never exceed the
 * application's, so Bambu Studio always loads a preset carrying it.
 */
export const FALLBACK_PRESET_VERSION = "0.0.0";

/**
 * Normalizes a Bambu version string to the form Studio stores in a preset: three or four
 * dot-separated numeric components with leading zeros stripped ("02.08.00.04" -> "2.8.0.4").
 * Returns undefined for anything Studio's Semver parse would reject.
 */
export function normalizeVersion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const parts = raw.trim().split(".");
  if (parts.length < 3 || parts.length > 4) return undefined;
  if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
  return parts.map((part) => String(Number(part))).join(".");
}

/**
 * The vendor bundle's config version, read from resources/profiles/<vendor>.json and normalized.
 * This is the version Bambu Studio stamps on every preset of that vendor.
 */
export async function readVendorVersion(
  cfg: ServerConfig,
  vendor: string
): Promise<string | undefined> {
  const indexPath = join(cfg.installDir, "resources", "profiles", `${vendor}.json`);
  if (!existsSync(indexPath)) return undefined;
  try {
    const raw: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    return normalizeVersion((raw as { version?: unknown }).version);
  } catch {
    return undefined;
  }
}

export interface Loadability {
  ok: boolean;
  /** Present when ok is false. */
  reason?: string;
  /** True when the application version was available and the major condition was evaluated. */
  appVersionChecked: boolean;
}

/**
 * Whether Bambu Studio loads a user preset carrying this version. Studio skips a preset whose
 * version is absent or unparseable, and one whose major exceeds the running application's. The
 * major condition is evaluated only when the application version is known; an unknown application
 * version never makes a preset unloadable.
 */
export function evaluateLoadability(
  presetVersion: unknown,
  appVersion: string | undefined
): Loadability {
  const normalized = normalizeVersion(presetVersion);
  if (normalized === undefined) {
    return {
      ok: false,
      reason: strings.messages.versionMissingOrUnparseable(presetVersion),
      appVersionChecked: false,
    };
  }
  const app = normalizeVersion(appVersion);
  if (app === undefined) return { ok: true, appVersionChecked: false };
  if (Number(normalized.split(".")[0]) > Number(app.split(".")[0])) {
    return {
      ok: false,
      reason: strings.messages.versionMajorAhead(normalized, app),
      appVersionChecked: true,
    };
  }
  return { ok: true, appVersionChecked: true };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/versions.test.ts tests/strings.test.ts`
Expected: PASS. `tests/strings.test.ts` may assert that every message is referenced; if it fails, follow its existing convention for registering new messages.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test
git add src/versions.ts src/strings.ts tests/versions.test.ts tests/fixtures/install/resources/profiles/BBL.json
git commit -m "feat: add preset version normalization, vendor lookup and loadability"
```

---

### Task 3: import_profile writes a version and reports honestly

`src/tools/import.ts:81` sources `version` from the resolved parent chain. System presets never carry that key, so no import has ever written a version and Bambu Studio has silently refused every installed preset. The note compounds it by reporting keys stripped from the source rather than keys written.

**Files:**
- Modify: `src/tools/import.ts:81-100`
- Modify: `src/user-presets.ts` (`STUDIO_RESTART_NOTE`)
- Modify: `src/strings.ts`
- Test: `tests/tools-import.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: `readVendorVersion`, `FALLBACK_PRESET_VERSION`, `evaluateLoadability` (Task 2); `readAppVersion` (Task 1).
- Produces: `ImportResult` gains `version: string`, `versionSource: "vendor" | "fallback"`, `metadataWritten: string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools-import.test.ts`:

```typescript
it("writes the vendor bundle version, normalized", async () => {
  await writeSource("Imported Draft", {
    name: "Imported Draft",
    inherits: "0.20mm Standard @BBL X1C",
    layer_height: "0.16",
  });
  const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(installed.version).toBe("2.8.0.4");
  expect(result.version).toBe("2.8.0.4");
  expect(result.versionSource).toBe("vendor");
});

it("writes a version even though no preset in the parent chain carries one", async () => {
  await writeSource("Imported Draft", {
    name: "Imported Draft",
    inherits: "0.20mm Standard @BBL X1C",
    layer_height: "0.16",
  });
  const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
  const chainRoot = JSON.parse(
    await readFile(
      join(FIXTURES, "install", "resources", "profiles", "BBL", "process", "fdm_process_common.json"),
      "utf8"
    )
  );
  expect(chainRoot.version).toBeUndefined();
  expect(JSON.parse(await readFile(result.path, "utf8")).version).toBe("2.8.0.4");
});

it("falls back to 0.0.0 and says so when the vendor index carries no version", async () => {
  const install = join(tmp, "install");
  await mkdir(join(install, "resources", "profiles", "BBL", "process"), { recursive: true });
  await writeFile(
    join(install, "resources", "profiles", "BBL.json"),
    JSON.stringify({ name: "Bambulab" }),
    "utf8"
  );
  await writeFile(
    join(install, "resources", "profiles", "BBL", "process", "base.json"),
    JSON.stringify({ name: "base", layer_height: "0.2" }),
    "utf8"
  );
  await writeSource("Fallback Draft", { name: "Fallback Draft", inherits: "base", layer_height: "0.16" });
  const fallbackDeps: ToolDeps = {
    ...deps(),
    config: new TempConfig({ installDir: install, userDataDir: userStore, userId: "u1" }),
  };
  const result = await handleImport(fallbackDeps, "process", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Fallback Draft",
    overwrite: false,
  });
  expect(result.version).toBe("0.0.0");
  expect(result.versionSource).toBe("fallback");
  expect(JSON.parse(await readFile(result.path, "utf8")).version).toBe("0.0.0");
});

it("reports the metadata keys it wrote, not the keys stripped from the source", async () => {
  await writeSource("Imported Draft", {
    name: "Imported Draft",
    inherits: "0.20mm Standard @BBL X1C",
    from: "System",
    layer_height: "0.16",
  });
  const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(result.metadataWritten.sort()).toEqual(["from", "print_settings_id", "version"]);
  for (const key of result.metadataWritten) expect(installed[key]).toBeDefined();
});

it("writes filament_settings_id and a version for a filament preset", async () => {
  await writeSource("Imported Filament", {
    name: "Imported Filament",
    inherits: "Generic PLA @BBL X1C",
    nozzle_temperature: ["215"],
  });
  const result = await handleImport(deps(), "filament", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Imported Filament",
    overwrite: false,
  });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(installed.version).toBe("2.8.0.4");
  expect(installed.filament_settings_id).toEqual(["Imported Filament"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tools-import.test.ts`
Expected: FAIL — `installed.version` is `undefined`, `result.version` is not a property.

- [ ] **Step 3: Add the strings**

In `src/strings.ts`, replace `importMetadataRegenerated` with a message about written keys, and reword the restart note:

```typescript
    studioRestartNote:
      "Bambu Studio reads user presets at startup, so it picks this up after a restart. A preset " +
      "whose compatible_printers excludes the selected machine stays hidden until that machine is selected.",
    // Source: src/tools/import.ts handleImport
    importMetadataWritten: (keys: string[]): string =>
      `Metadata written into the installed preset: ${keys.join(", ")}.`,
    importVersionFallback: (version: string, vendor: string): string =>
      `Vendor '${vendor}' supplies no usable bundle version, so the preset carries ${version}.`,
    importNotLoadable: (path: string, reason: string): string =>
      `Installed preset '${path}' ${reason} The file was written; remove it with remove_profile.`,
```

Delete `importMetadataRegenerated` and its call site.

- [ ] **Step 4: Rewrite the body construction**

In `src/tools/import.ts`, add the imports:

```typescript
import { readAppVersion } from "../config.js";
import { evaluateLoadability, readVendorVersion, FALLBACK_PRESET_VERSION } from "../versions.js";
```

Extend the result interface:

```typescript
export interface ImportResult {
  kind: WritableProfileKind;
  name: string;
  path: string;
  infoPath: string;
  overwritten: boolean;
  /** Version written into the preset. */
  version: string;
  /** Where that version came from. */
  versionSource: "vendor" | "fallback";
  /** Metadata keys the installed file carries. */
  metadataWritten: string[];
  note: string;
}
```

Replace the `const version = resolvedBase.settings.version;` block and the `note` block:

```typescript
  const vendorVersion = await readVendorVersion(cfg, args.vendor);
  const version = vendorVersion ?? FALLBACK_PRESET_VERSION;
  const versionSource = vendorVersion === undefined ? "fallback" : "vendor";
  const settingsIdKey = kind === "process" ? "print_settings_id" : "filament_settings_id";

  const body: Record<string, unknown> = {
    name: args.name,
    inherits: source.inherits,
    from: "User",
    version,
    ...(kind === "process"
      ? { print_settings_id: args.name }
      : { filament_settings_id: [args.name] }),
    ...kvps,
  };
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(body, null, 4) + "\n", "utf8");
  await writeFile(infoPath, formatInfoSidecar(Math.floor(Date.now() / 1000)), "utf8");

  const written: unknown = JSON.parse(await readFile(jsonPath, "utf8"));
  const loadability = evaluateLoadability(
    (written as RawProfile).version,
    await readAppVersion(cfg.userDataDir)
  );
  if (!loadability.ok) {
    throw new Error(strings.messages.importNotLoadable(jsonPath, loadability.reason ?? ""));
  }

  const metadataWritten = ["from", "version", settingsIdKey];
  const note =
    versionSource === "fallback"
      ? `${strings.messages.importMetadataWritten(metadataWritten)} ` +
        `${strings.messages.importVersionFallback(version, args.vendor)} ${STUDIO_RESTART_NOTE}`
      : `${strings.messages.importMetadataWritten(metadataWritten)} ${STUDIO_RESTART_NOTE}`;
  return {
    kind,
    name: args.name,
    path: jsonPath,
    infoPath,
    overwritten,
    version,
    versionSource,
    metadataWritten,
    note,
  };
```

Delete the now-unused `const regenerated = SYNTHESIZED_METADATA_KEYS.filter(...)` line; keep the `skipped` set that follows it, which still strips metadata off the source.

- [ ] **Step 5: Update the tool description**

In `src/strings.ts`, `tools.importProfile.description` — the Returns section names the version and its source. Keep the Purpose / Returns / Errors / pointers shape and use no negations.

- [ ] **Step 6: Add the protocol assertion**

In `tests/server.test.ts`, in the existing `import_profile` call, assert the new fields appear in `structuredContent`:

```typescript
expect(result.structuredContent).toMatchObject({ versionSource: "vendor" });
expect(result.structuredContent.version).toBe("2.8.0.4");
```

- [ ] **Step 7: Run the suite and commit**

```bash
npm test
git add src/tools/import.ts src/user-presets.ts src/strings.ts tests/tools-import.test.ts tests/server.test.ts
git commit -m "fix: import_profile writes the vendor bundle version and reports what it wrote"
```

---

### Task 4: The resolver expands `include`

`loadChain` walks `inherits` only. `include` is unhandled and unreported, so a resolve silently disagrees with Studio for every preset that uses one — in the shipped BBL bundle that is most filament presets and a set of machine presets. Studio's order is: the `inherits` parent's config, then each include target in listed order, then the file's own keys (`PresetBundle.cpp:4860-4908`).

**Files:**
- Modify: `src/resolver.ts`
- Modify: `src/types.ts` (additive)
- Modify: `src/tools/lint.ts:180-186` (call sites of `loadChain`/`mergeChain`)
- Create: `tests/fixtures/install/resources/profiles/BBL/filament/fdm_filament_template_dual.json`
- Test: `tests/resolver.test.ts`, `tests/tools-resolve.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ChainLayer { profile: RawProfile; includedBy?: string }`
  - `loadChain(store, kind, vendor, name): Promise<ChainLayer[]>` (return type changed)
  - `mergeChain(layers: ChainLayer[], options?: ResolveOptions): MergedSettings`
  - `ResolvedProfile.included?: Record<string, string[]>`

- [ ] **Step 1: Add the include-target fixture**

Create `tests/fixtures/install/resources/profiles/BBL/filament/fdm_filament_template_dual.json`:

```json
{
  "type": "filament",
  "name": "fdm_filament_template_dual",
  "from": "system",
  "instantiation": "false",
  "filament_extruder_variant": ["Direct Drive Standard", "Direct Drive High Flow"],
  "nozzle_temperature": ["200", "200"]
}
```

- [ ] **Step 2: Write the failing resolver tests**

Append to `tests/resolver.test.ts`:

```typescript
describe("include expansion", () => {
  it("applies an include target between the inherits chain and the file's own keys", async () => {
    const store = fakeStore({
      root: { name: "root", layer_height: "0.2", nozzle_temperature: ["190"] },
      tmpl: { name: "tmpl", nozzle_temperature: ["200", "200"], fan_max_speed: ["80", "80"] },
      leaf: { name: "leaf", inherits: "root", include: ["tmpl"], fan_max_speed: ["90", "90"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "leaf");
    expect(result.settings.layer_height).toBe("0.2");
    expect(result.settings.nozzle_temperature).toEqual(["200", "200"]);
    expect(result.settings.fan_max_speed).toEqual(["90", "90"]);
  });

  it("keeps the inherits chain free of include targets and reports them separately", async () => {
    const store = fakeStore({
      root: { name: "root", layer_height: "0.2" },
      tmpl: { name: "tmpl", fan_max_speed: ["80", "80"] },
      leaf: { name: "leaf", inherits: "root", include: ["tmpl"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "leaf");
    expect(result.chain).toEqual(["root", "leaf"]);
    expect(result.included).toEqual({ leaf: ["tmpl"] });
  });

  it("omits included from a resolve where no layer uses include", async () => {
    const store = fakeStore({ solo: { name: "solo", layer_height: "0.2" } });
    expect((await resolveProfile(store, "process", "BBL", "solo")).included).toBeUndefined();
  });

  it("keeps the include key out of the resolved settings", async () => {
    const store = fakeStore({
      tmpl: { name: "tmpl", fan_max_speed: ["80", "80"] },
      leaf: { name: "leaf", include: ["tmpl"] },
    });
    expect((await resolveProfile(store, "filament", "BBL", "leaf")).settings.include).toBeUndefined();
  });

  it("fills a nil column of an include target from the inherits chain", async () => {
    const store = fakeStore({
      root: { name: "root", filament_retraction_length: ["0.8", "0.8"] },
      tmpl: { name: "tmpl", filament_retraction_length: ["nil", "1.2"] },
      leaf: { name: "leaf", inherits: "root", include: ["tmpl"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "leaf");
    expect(result.settings.filament_retraction_length).toEqual(["0.8", "1.2"]);
  });

  it("expands the include target's own inherits chain", async () => {
    const store = fakeStore({
      tmpl_base: { name: "tmpl_base", fan_max_speed: ["70", "70"], bed_type: "textured" },
      tmpl: { name: "tmpl", inherits: "tmpl_base", fan_max_speed: ["80", "80"] },
      leaf: { name: "leaf", include: ["tmpl"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "leaf");
    expect(result.settings.fan_max_speed).toEqual(["80", "80"]);
    expect(result.settings.bed_type).toBe("textured");
    expect(result.chain).toEqual(["leaf"]);
  });

  it("applies several include targets in listed order", async () => {
    const store = fakeStore({
      first: { name: "first", fan_max_speed: ["10", "10"], nozzle_temperature: ["200", "200"] },
      second: { name: "second", fan_max_speed: ["20", "20"] },
      leaf: { name: "leaf", include: ["first", "second"] },
    });
    const result = await resolveProfile(store, "filament", "BBL", "leaf");
    expect(result.settings.fan_max_speed).toEqual(["20", "20"]);
    expect(result.settings.nozzle_temperature).toEqual(["200", "200"]);
  });

  it("throws ProfileNotFoundError for a missing include target", async () => {
    const store = fakeStore({ leaf: { name: "leaf", include: ["ghost"] } });
    await expect(resolveProfile(store, "filament", "BBL", "leaf")).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });

  it("throws CircularInheritanceError when includes close on themselves", async () => {
    const store = fakeStore({
      a: { name: "a", include: ["b"] },
      b: { name: "b", include: ["a"] },
    });
    await expect(resolveProfile(store, "filament", "BBL", "a")).rejects.toBeInstanceOf(
      CircularInheritanceError
    );
  });
});
```

Existing tests in this file that call `loadChain` or `mergeChain` directly must be updated to the `ChainLayer[]` shape — wrap raw profiles as `{ profile }` and read `layer.profile.name`. Search with `grep -n "loadChain\|mergeChain" tests/*.ts`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/resolver.test.ts`
Expected: FAIL — include targets are ignored; `included` is undefined; `settings.include` is present.

- [ ] **Step 4: Implement include expansion**

In `src/resolver.ts`, add `"include"` to the identity keys so it never reaches the settings:

```typescript
/** Identity keys that never take part in the merged settings. */
const IDENTITY_KEYS = new Set<string>(["name", "inherits", "include"]);
```

Replace `loadChain` with:

```typescript
/** One layer of a merge: a profile, and the layer that pulled it in when it came from `include`. */
export interface ChainLayer {
  profile: RawProfile;
  /** Name of the layer whose `include` array named this one; absent for inherits-chain layers. */
  includedBy?: string;
}

/** The names a profile's `include` array holds, ignoring non-string elements. */
function includeNames(profile: RawProfile): string[] {
  const raw = profile.include;
  return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === "string") : [];
}

/**
 * Walks a profile's `inherits` chain and returns it root-first, with each layer's `include` targets
 * spliced in immediately before that layer. Bambu Studio applies the inherits parent first, then
 * each include target in listed order, then the layer's own keys. Throws when a link or an include
 * target is missing, or when either closes on itself.
 */
export async function loadChain(
  store: ProfileStore,
  kind: ReadableProfileKind,
  vendor: string,
  name: string,
  stack: readonly string[] = []
): Promise<ChainLayer[]> {
  const chainLeafFirst: RawProfile[] = [];
  const visited = new Set<string>(stack);
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

  const layers: ChainLayer[] = [];
  for (const profile of [...chainLeafFirst].reverse()) {
    for (const target of includeNames(profile)) {
      const included = await loadChain(store, kind, vendor, target, [...visited]);
      for (const layer of included) {
        layers.push({ profile: layer.profile, includedBy: profile.name });
      }
    }
    layers.push({ profile });
  }
  return layers;
}
```

Change `mergeChain` to take `ChainLayer[]` and merge `layer.profile`:

```typescript
export function mergeChain(layers: ChainLayer[], options: ResolveOptions = {}): MergedSettings {
  const deferred = options.machineDeferredKeys ?? new Set<string>();
  const settings: Record<string, unknown> = {};
  const resolvedColumns = new Map<string, number[]>();

  for (const layer of layers) mergeLayer(settings, layer.profile, deferred, resolvedColumns);
```

The rest of `mergeChain` is unchanged.

Change `resolveProfile` to build `chain` from the inherits layers only and report the include targets:

```typescript
export async function resolveProfile(
  store: ProfileStore,
  kind: ReadableProfileKind,
  vendor: string,
  name: string,
  options: ResolveOptions = {}
): Promise<ResolvedProfile> {
  const layers = await loadChain(store, kind, vendor, name);
  const included: Record<string, string[]> = {};
  for (const layer of layers) {
    if (layer.includedBy === undefined) continue;
    const list = included[layer.includedBy] ?? [];
    if (!list.includes(layer.profile.name)) list.push(layer.profile.name);
    included[layer.includedBy] = list;
  }
  return {
    vendor,
    name,
    kind,
    chain: layers.filter((l) => l.includedBy === undefined).map((l) => l.profile.name),
    ...(Object.keys(included).length > 0 ? { included } : {}),
    ...mergeChain(layers, options),
  };
}
```

Note on `included`: a target's own inherits ancestors are recorded under the including layer too, which is what the caller needs to see — every name that entered the merge because of an `include`.

- [ ] **Step 5: Extend the ResolvedProfile contract**

In `src/types.ts`, add to `ResolvedProfile`:

```typescript
  /** Layer name -> the names that entered the merge through that layer's `include` array. */
  included?: Record<string, string[]>;
```

- [ ] **Step 6: Update the lint call site**

In `src/tools/lint.ts`, `handleLint` builds a synthetic leaf layer. Change:

```typescript
  const baseChain = await loadChain(store, kind, args.vendor, source.inherits);
  const parent = mergeChain(baseChain, options);
  const resolved = mergeChain([...baseChain, { profile: { name: args.name, ...overrides } }], options);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/resolver.test.ts tests/tools-lint.test.ts tests/tools-resolve.test.ts`
Expected: PASS.

- [ ] **Step 8: Add a fixture-backed resolve test**

Append to `tests/tools-resolve.test.ts` a test that resolves a fixture filament preset carrying `include: ["fdm_filament_template_dual"]`. Add that key to `tests/fixtures/install/resources/profiles/BBL/filament/Generic PLA @BBL X1C.json`:

```json
{
  "name": "Generic PLA @BBL X1C",
  "inherits": "fdm_filament_common",
  "include": ["fdm_filament_template_dual"],
  "filament_id": "GFB99",
  "nozzle_temperature": ["210"]
}
```

```typescript
it("expands include when resolving a shipped-shape filament preset", async () => {
  const result = await handleResolve(deps(), "filament", {
    vendor: "BBL",
    name: "Generic PLA @BBL X1C",
  });
  expect(result.settings.filament_extruder_variant).toEqual([
    "Direct Drive Standard",
    "Direct Drive High Flow",
  ]);
  expect(result.settings.nozzle_temperature).toEqual(["210"]);
  expect(result.included).toEqual({ "Generic PLA @BBL X1C": ["fdm_filament_template_dual"] });
});
```

Changing that fixture affects other suites. Run `npm test` and fix any assertion that counted on the old resolved shape.

- [ ] **Step 9: Update the tool descriptions**

In `src/strings.ts`, `tools.resolveProfile.description` — the Returns section names `included` alongside `nilResolved`/`nilUnresolved`.

- [ ] **Step 10: Run the full suite and commit**

```bash
npm test
git add src/resolver.ts src/types.ts src/tools/lint.ts src/strings.ts tests/ 
git commit -m "fix: resolve include targets as merge layers"
```

---

### Task 5: import_profile writes the structural extruder keys

`Preset.cpp:661-666` appends the kind's extruder-id and extruder-variant keys to `dirty_options` on every save with a parent, whether or not they equal the parent. An installed preset lacking them acquires them on the first Studio save, which shows up as drift.

**Files:**
- Modify: `src/user-presets.ts`
- Modify: `src/tools/import.ts`
- Test: `tests/tools-import.test.ts`

**Interfaces:**
- Consumes: `ImportResult` (Task 3); include-aware `resolveProfile` (Task 4).
- Produces: `STRUCTURAL_KEYS: Record<WritableProfileKind, readonly string[]>` exported from `src/user-presets.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools-import.test.ts`:

```typescript
it("writes the process structural keys from the resolved chain", async () => {
  await writeSource("Imported Draft", {
    name: "Imported Draft",
    inherits: "0.20mm Standard @BBL X1C",
    layer_height: "0.16",
  });
  const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(installed.print_extruder_variant).toEqual(["Direct Drive Standard"]);
});

it("writes filament_extruder_variant with the columns the include supplies", async () => {
  await writeSource("Imported Filament", {
    name: "Imported Filament",
    inherits: "Generic PLA @BBL X1C",
    nozzle_temperature: ["215"],
  });
  const result = await handleImport(deps(), "filament", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Imported Filament",
    overwrite: false,
  });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(installed.filament_extruder_variant).toEqual([
    "Direct Drive Standard",
    "Direct Drive High Flow",
  ]);
});

it("keeps an explicit structural override from the source file", async () => {
  await writeSource("Imported Draft", {
    name: "Imported Draft",
    inherits: "0.20mm Standard @BBL X1C",
    print_extruder_variant: ["Direct Drive High Flow"],
  });
  const result = await handleImport(deps(), "process", { ...PROCESS_ARGS, outputDir: outDir });
  const installed = JSON.parse(await readFile(result.path, "utf8"));
  expect(installed.print_extruder_variant).toEqual(["Direct Drive High Flow"]);
});
```

The first test requires `print_extruder_variant` in the process fixture chain. Add it to `tests/fixtures/install/resources/profiles/BBL/process/fdm_process_common.json` as `"print_extruder_variant": ["Direct Drive Standard"]`, and add `print_extruder_variant` (`{"type": "string", "vector": true, "default": ""}`) plus `print_extruder_id` (`{"type": "int", "vector": true, "default": 0}`) and `filament_extruder_variant` (`{"type": "string", "vector": true, "default": ""}`) to the matching `tests/fixtures/schema/*.schema.json`, or the schema validation in `handleImport` rejects the third test's source file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tools-import.test.ts`
Expected: FAIL — `installed.print_extruder_variant` is `undefined`.

- [ ] **Step 3: Declare the structural keys**

In `src/user-presets.ts`:

```typescript
/**
 * Keys Bambu Studio writes into a user preset on every save with a parent, whether or not they
 * equal the parent's value (Preset::save appends them to dirty_options unconditionally). An
 * installed preset carries them so the first Studio save produces no drift.
 */
export const STRUCTURAL_KEYS: Record<WritableProfileKind, readonly string[]> = {
  process: ["print_extruder_id", "print_extruder_variant"],
  filament: ["filament_extruder_variant"],
};
```

- [ ] **Step 4: Write them in the import body**

In `src/tools/import.ts`, import `STRUCTURAL_KEYS` and build the structural block before `body`:

```typescript
  const structural: Record<string, unknown> = {};
  for (const key of STRUCTURAL_KEYS[kind]) {
    if (key in kvps) continue;
    const value = resolvedBase.settings[key];
    if (value !== undefined) structural[key] = value;
  }
```

and place it in `body` between the settings-id entry and `...kvps`:

```typescript
    ...structural,
    ...kvps,
```

- [ ] **Step 5: Run the tests and the suite**

Run: `npx vitest run tests/tools-import.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/user-presets.ts src/tools/import.ts tests/
git commit -m "fix: import_profile writes the structural extruder keys Studio always rewrites"
```

---

### Task 6: The schema carries a perVariant flag

`PrintConfig.cpp` declares which options are indexed by extruder variant, per preset type. The schema has no such flag, so the linter has no way to tell a per-extruder vector from an ordinary one. Emit the flag from the parser, and regenerate against the checkout at `D:\repos\BambuStudio`.

**Files:**
- Modify: `scripts/generate-schema/parse.ts:252-257`
- Modify: `scripts/generate-schema/index.ts`
- Modify: `src/types.ts` (additive)
- Modify: `schema/process.schema.json`, `schema/filament.schema.json`, `schema/machine.schema.json` (regenerated, never hand-edited)
- Modify: `tests/fixtures/cpp/print-config-snippet.cpp`, `tests/fixtures/schema/*.schema.json`
- Modify: `CLAUDE.md`, `README.md:189-192`
- Test: `tests/generate-schema.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SchemaOption.perVariant?: boolean`; `parseStringCollection(cppSource: string, name: string): string[]` replacing `parseStringVector`.

- [ ] **Step 1: Extend the C++ fixture**

Append to `tests/fixtures/cpp/print-config-snippet.cpp`:

```cpp
std::set<std::string> print_options_with_variant = {
    "outer_wall_speed",
    // BBS
    "initial_layer_speed"
};

std::set<std::string> filament_options_with_variant = {
    "filament_retraction_length"
};

std::set<std::string> printer_options_with_variant_1 = {
    "nozzle_diameter"
};

std::set<std::string> printer_options_with_variant_2 = {
    "retraction_length"
};
```

- [ ] **Step 2: Write the failing parser tests**

Append to `tests/generate-schema.test.ts`:

```typescript
describe("parseStringCollection", () => {
  it("reads a std::vector<std::string> declaration", () => {
    expect(parseStringCollection(source, "filament_overhang_override_keys")).toEqual([
      "filament_bridge_speed",
    ]);
  });

  it("reads a std::set<std::string> declaration", () => {
    expect(parseStringCollection(source, "print_options_with_variant")).toEqual([
      "outer_wall_speed",
      "initial_layer_speed",
    ]);
  });

  it("returns an empty array for a name it cannot find", () => {
    expect(parseStringCollection(source, "no_such_declaration")).toEqual([]);
  });
});
```

`source` is the existing fixture text this suite already loads; follow the file's existing setup.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/generate-schema.test.ts`
Expected: FAIL — `parseStringCollection` is not exported.

- [ ] **Step 4: Generalize the parser**

In `scripts/generate-schema/parse.ts`, replace `parseStringVector`:

```typescript
/**
 * Extracts the quoted keys of a `std::vector<std::string>` or `std::set<std::string>` declaration,
 * with or without a `const` qualifier.
 */
export function parseStringCollection(cppSource: string, name: string): string[] {
  const decl = cppSource.match(
    new RegExp(`std::(?:vector|set)<std::string>\\s+${name}\\s*=?\\s*\\{([\\s\\S]*?)\\}\\s*;`)
  );
  if (!decl) return [];
  return [...stripComments(decl[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
```

Update every reference: `scripts/generate-schema/index.ts:17,47,48` and the existing occurrences in `tests/generate-schema.test.ts`.

- [ ] **Step 5: Extend the SchemaOption contract**

In `src/types.ts`, add to `SchemaOption`:

```typescript
  /**
   * True when Bambu Studio indexes this option by extruder variant, so its vector carries one
   * column per entry of the machine's printer_extruder_variant. Every other vector option carries
   * one column.
   */
  perVariant?: boolean;
```

- [ ] **Step 6: Emit the flag**

In `scripts/generate-schema/index.ts`, after `machineSchema` is built and before the description overlay:

```typescript
const perVariantSets = {
  process: parseStringCollection(printConfigSource, "print_options_with_variant"),
  filament: parseStringCollection(printConfigSource, "filament_options_with_variant"),
  machine: [
    ...parseStringCollection(printConfigSource, "printer_options_with_variant_1"),
    ...parseStringCollection(printConfigSource, "printer_options_with_variant_2"),
  ],
};
if (
  perVariantSets.process.length === 0 ||
  perVariantSets.filament.length === 0 ||
  perVariantSets.machine.length === 0
) {
  console.error(
    "Parsed no per-variant option keys for at least one preset kind. The " +
      "*_options_with_variant declarations in PrintConfig.cpp likely changed shape — inspect " +
      `${printConfigPath}.`
  );
  process.exit(1);
}

function markPerVariant(schema: ProfileSchema, keys: string[]): void {
  for (const key of keys) {
    const option = schema[key];
    if (option) option.perVariant = true;
  }
}
markPerVariant(processSchema, perVariantSets.process);
markPerVariant(filamentSchema, perVariantSets.filament);
markPerVariant(machineSchema, perVariantSets.machine);
```

- [ ] **Step 7: Regenerate the schema**

Run: `npx tsx scripts/generate-schema/index.ts "D:\repos\BambuStudio"`

Expected: it writes the three schema files and reports the description overlay coverage. The run reports options with no entry in `schema/descriptions.json` — that is expected for options this newer release adds, and authoring those descriptions is separate work under the clean-room rule. It must NOT report a machine-schema completeness failure; if it exits non-zero, stop and report.

Confirm the flag landed and the diff is additive:

```bash
git diff --stat schema/
node -e "const s=require('./schema/filament.schema.json');console.log(s.filament_max_volumetric_speed.perVariant, s.fan_max_speed.perVariant)"
```

Expected: `true undefined`.

- [ ] **Step 8: Update the fixture schemas**

Add `"perVariant": true` to `outer_wall_speed` in `tests/fixtures/schema/process.schema.json`, and to `filament_retraction_length` in `tests/fixtures/schema/filament.schema.json` if present. Leave every other vector option's flag absent — Task 7's tests rely on that contrast.

- [ ] **Step 9: Restate the regeneration rule**

`CLAUDE.md`, Commands section — the schema regeneration line takes the newest production release, not the tag matching the installed Studio:

```markdown
- Schema regeneration: `npx tsx scripts/generate-schema/index.ts <BambuStudio-checkout>` (checkout at the newest production release tag; never clone into this repo)
```

`README.md:189-192` carries the same rule in prose and the same `git clone --branch <matching-version-tag>` command. Restate both to the newest production release.

- [ ] **Step 10: Run the suite and commit**

```bash
npm test
git add scripts/ src/types.ts schema/ tests/ CLAUDE.md README.md
git commit -m "feat: schema carries a perVariant flag per option"
```

---

### Task 7: column-count measures against the right column count

The check applies the machine's `printer_extruder_variant.length` to every schema vector. On a filament preset that produces findings against keys that are single-column throughout Bambu's own chain. A vector option carries one column unless it is per-variant.

**Files:**
- Modify: `src/tools/lint.ts:113-130,190-215`
- Modify: `src/strings.ts`
- Test: `tests/tools-lint.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: `SchemaOption.perVariant` (Task 6).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools-lint.test.ts` (follow the file's existing helpers for writing a source file and building deps):

```typescript
it("leaves a single-column non-per-variant vector alone against a multi-variant machine", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "Generic PLA @BBL X1C",
    nozzle_temperature: ["215"],
  });
  const result = await handleLint(deps(), "filament", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
    machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
  });
  expect(result.findings.filter((f) => f.check === "column-count")).toEqual([]);
});

it("flags a non-per-variant vector that carries more than one column", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "Generic PLA @BBL X1C",
    nozzle_temperature: ["215", "215"],
  });
  const result = await handleLint(deps(), "filament", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
    machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
  });
  expect(result.findings.map((f) => f.key)).toContain("nozzle_temperature");
});

it("still measures a per-variant vector against the machine", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "0.20mm Standard @BBL X1C",
    outer_wall_speed: ["250"],
  });
  const result = await handleLint(deps(), "process", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
    machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
  });
  expect(result.findings.some((f) => f.check === "column-count" && f.key === "outer_wall_speed")).toBe(
    true
  );
});

it("checks non-per-variant vectors even without a machine name", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "Generic PLA @BBL X1C",
    nozzle_temperature: ["215", "215"],
  });
  const result = await handleLint(deps(), "filament", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
  });
  expect(result.findings.some((f) => f.check === "column-count")).toBe(true);
  expect(result.skipped.some((s) => s.check === "column-count")).toBe(true);
});
```

The third test needs the fixture machine's `printer_extruder_variant` to have a length other than 1; check `tests/fixtures/install/resources/profiles/BBL/machine/Bambu Lab X1 Carbon 0.4 nozzle.json` and set it to two entries if it is single-column, adjusting any existing lint assertion that depends on it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tools-lint.test.ts`
Expected: FAIL — the single-column filament vector is flagged.

- [ ] **Step 3: Add the strings**

In `src/strings.ts`:

```typescript
    lintColumnCountSingle: (actual: number): string =>
      `the array carries ${actual} columns; this option is indexed per filament, so it carries one`,
    lintColumnCountNeedsMachine:
      "pass machineName to measure per-extruder vectors against that printer's printer_extruder_variant.",
```

- [ ] **Step 4: Rewrite the check**

In `src/tools/lint.ts`, replace `columnCounts`:

```typescript
/** Vector arrays whose length contradicts the column count their option carries. */
function columnCounts(
  overrides: Record<string, unknown>,
  schema: ProfileSchema,
  variantColumns: number | undefined,
  machineName: string | undefined
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const option = schema[key];
    if (!option?.vector || !Array.isArray(value)) continue;
    if (option.perVariant) {
      if (variantColumns === undefined || machineName === undefined) continue;
      if (value.length === variantColumns) continue;
      findings.push({
        check: "column-count",
        key,
        detail: strings.messages.lintColumnCount(value.length, variantColumns, machineName),
      });
      continue;
    }
    if (value.length === 1) continue;
    findings.push({
      check: "column-count",
      key,
      detail: strings.messages.lintColumnCountSingle(value.length),
    });
  }
  return findings;
}
```

Replace the `skipped` block in `handleLint` so the check always runs and only its per-variant half can be skipped:

```typescript
  const shaped = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !mismatches.some((m) => m.key === key))
  );
  const skipped: LintSkipped[] = [];
  let variantColumns: number | undefined;
  if (args.machineName === undefined) {
    skipped.push({ check: "column-count", reason: strings.messages.lintColumnCountNeedsMachine });
  } else {
    const machine = await resolveProfile(store, "machine", args.vendor, args.machineName);
    const variant = machine.settings.printer_extruder_variant;
    if (Array.isArray(variant)) {
      variantColumns = variant.length;
    } else {
      skipped.push({
        check: "column-count",
        reason: strings.messages.lintColumnCountNoVariant(args.machineName),
      });
    }
  }
  findings.push(...columnCounts(shaped, schema, variantColumns, args.machineName));
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/tools-lint.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the tool description**

In `src/strings.ts`, `tools.lintProfile.description` — the `column-count` wording says the check measures per-extruder vectors against the machine and every other vector against one column. Keep the section shape and avoid negations.

- [ ] **Step 7: Run the suite and commit**

```bash
npm test
git add src/tools/lint.ts src/strings.ts tests/
git commit -m "fix: column-count measures per-variant vectors against the machine and the rest against one"
```

---

### Task 8: parent-equal-override exempts the structural keys

`parent-equal-override` advises removing keys Studio rewrites on every save. Following that advice produces permanent drift.

**Files:**
- Modify: `src/tools/lint.ts:74-92,170-190`
- Test: `tests/tools-lint.test.ts`

**Interfaces:**
- Consumes: `STRUCTURAL_KEYS` from `src/user-presets.ts` (Task 5).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/tools-lint.test.ts`:

```typescript
it("stays silent on structural keys that equal the parent", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "0.20mm Standard @BBL X1C",
    print_extruder_variant: ["Direct Drive Standard"],
  });
  const result = await handleLint(deps(), "process", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
  });
  expect(result.findings.filter((f) => f.check === "parent-equal-override")).toEqual([]);
});

it("still flags an ordinary key that equals the parent", async () => {
  await writeSource("Lint Me", {
    name: "Lint Me",
    inherits: "0.20mm Standard @BBL X1C",
    wall_loops: "3",
  });
  const result = await handleLint(deps(), "process", {
    vendor: "BBL",
    outputDir: outDir,
    name: "Lint Me",
  });
  expect(result.findings.map((f) => f.key)).toContain("wall_loops");
});
```

The first test requires the fixture chain to resolve `print_extruder_variant` to `["Direct Drive Standard"]`, which Task 5 added to `fdm_process_common.json`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tools-lint.test.ts`
Expected: FAIL — `print_extruder_variant` is reported as dead weight.

- [ ] **Step 3: Exempt the keys**

In `src/tools/lint.ts`, import `STRUCTURAL_KEYS` from `../user-presets.js` and give `parentEqualOverrides` the kind:

```typescript
/** Every key the file states at the same value the chain already resolves to. */
function parentEqualOverrides(
  kind: WritableProfileKind,
  overrides: Record<string, unknown>,
  parentSettings: Record<string, unknown>
): LintFinding[] {
  const structural = new Set<string>(STRUCTURAL_KEYS[kind]);
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (structural.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(parentSettings, key)) continue;
    if (!deepEqual(value, parentSettings[key])) continue;
    findings.push({
      check: "parent-equal-override",
      key,
      detail: strings.messages.lintParentEqualOverride(parentSettings[key]),
    });
  }
  return findings;
}
```

Update the call in `handleLint` to `parentEqualOverrides(kind, overrides, parent.settings)`.

- [ ] **Step 4: Run the tests, then the suite**

Run: `npx vitest run tests/tools-lint.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/lint.ts tests/tools-lint.test.ts
git commit -m "fix: parent-equal-override exempts the keys Studio always rewrites"
```

---

### Task 9: diff_profile reports loadability

`diff_profile` compares content keys and skips metadata by design, so `version` — the one field that decides whether the preset exists for Studio — is outside its view. `identical: true` therefore reads as "installed and working" while meaning neither.

**Files:**
- Modify: `src/tools/diff.ts`
- Modify: `src/strings.ts`
- Test: `tests/tools-diff.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: `evaluateLoadability`, `Loadability` (Task 2); `readAppVersion` (Task 1).
- Produces: `DiffResult.loadable: Loadability`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools-diff.test.ts` (follow the file's existing helpers):

```typescript
it("reports an installed preset carrying a version as loadable", async () => {
  await writeInstalled("Drift Me", {
    name: "Drift Me",
    inherits: "0.20mm Standard @BBL X1C",
    from: "User",
    version: "2.8.0.4",
    layer_height: "0.16",
  });
  await writeSource("Drift Me", {
    name: "Drift Me",
    inherits: "0.20mm Standard @BBL X1C",
    layer_height: "0.16",
  });
  const result = await handleDiff(deps(), "process", { name: "Drift Me", outputDir: outDir });
  expect(result.identical).toBe(true);
  expect(result.loadable.ok).toBe(true);
});

it("reports identical content and an unloadable preset when the version is absent", async () => {
  await writeInstalled("Drift Me", {
    name: "Drift Me",
    inherits: "0.20mm Standard @BBL X1C",
    from: "User",
    layer_height: "0.16",
  });
  await writeSource("Drift Me", {
    name: "Drift Me",
    inherits: "0.20mm Standard @BBL X1C",
    layer_height: "0.16",
  });
  const result = await handleDiff(deps(), "process", { name: "Drift Me", outputDir: outDir });
  expect(result.identical).toBe(true);
  expect(result.loadable.ok).toBe(false);
  expect(result.loadable.reason).toBeTypeOf("string");
  expect(result.loadable.appVersionChecked).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tools-diff.test.ts`
Expected: FAIL — `result.loadable` is undefined.

- [ ] **Step 3: Add the field**

In `src/tools/diff.ts`, import `readAppVersion` from `../config.js` and `evaluateLoadability`, `type Loadability` from `../versions.js`. Extend the result interface:

```typescript
export interface DiffResult {
  kind: WritableProfileKind;
  name: string;
  identical: boolean;
  /** Whether Bambu Studio loads the installed preset at all. */
  loadable: Loadability;
  changed: { key: string; source: unknown; installed: unknown }[];
  onlyInSource: { key: string; value: unknown }[];
  onlyInstalled: { key: string; value: unknown }[];
  source: DiffFileInfo;
  installed: DiffFileInfo;
  newer: "source" | "installed" | "same";
}
```

In `handleDiff`, after the two profiles are read and before the return:

```typescript
  const loadable = evaluateLoadability(installed.version, await readAppVersion(cfg.userDataDir));
```

and add `loadable,` to the returned object.

- [ ] **Step 4: Update the tool description**

In `src/strings.ts`, `tools.diffProfile.description` — the Returns section states that `identical` covers content keys and `loadable` covers whether Bambu Studio loads the installed preset. Keep the section shape, no negations.

- [ ] **Step 5: Add the protocol assertion**

In `tests/server.test.ts`, in the existing `diff_profile` calls, assert `structuredContent.loadable` carries `ok` and `appVersionChecked`.

- [ ] **Step 6: Run the suite and commit**

```bash
npm test
git add src/tools/diff.ts src/strings.ts tests/
git commit -m "feat: diff_profile reports whether Studio loads the installed preset"
```

---

### Task 10: Open the pull request

**Files:** none.

- [ ] **Step 1: Verify the branch is green**

```bash
npm test
npm run build
```

Expected: both succeed.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin fix/resolver-and-install-correctness
gh pr create --title "fix: resolver and install correctness" --body-file docs/superpowers/specs/2026-08-26-resolver-and-install-correctness-design.md
```

- [ ] **Step 3: Wait for the `ci` check and report**

```bash
gh pr checks --watch
```

Report the result. Do not merge; `main` is protected and the merge is the maintainer's call.
