# String Resource Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every user-facing string the server emits into one typed resource module, `src/strings.ts`, with zero behavioral change.

**Architecture:** A leaf TypeScript module exports a `const`-typed `strings` object (static texts) and named functions (parameterized messages). Consumers import from it; no other module contains user-facing literals afterwards.

**Tech Stack:** TypeScript strict ESM, Vitest (existing setup; no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-23-string-resources-design.md`

## Global Constraints

- Pure refactor: every emitted string is byte-identical before and after. The existing test suite is the regression net — **no existing test file may be edited**; all pass unchanged.
- `src/strings.ts` is a leaf module: type-only imports allowed, no value imports from `src/`.
- `src/types.ts` unchanged. Public handler signatures unchanged. Tool names, annotations, and schemas' zod structure unchanged (only where `.describe(...)` texts COME FROM changes).
- TypeScript: `strict: true`, no `any` (use `unknown`), explicit return types on exported functions.
- Test commands: `npx vitest run <file>` / `npm test`. Commit after every task; messages given per task.
- This plan runs concurrently with the schema-description-reauthoring plan, which touches ONLY `scripts/generate-schema/**`, `schema/**`, `tests/generate-schema.test.ts`, and `tests/fixtures/cpp|schema/**`. Do not touch those paths in this plan's tasks.

## Transcription rule (applies to every task)

Strings are TRANSCRIBED from the current source files, never retyped from memory and never "improved". When a step says "move string X from file Y", copy the exact literal (including concatenation joints, `\n\n` separators, quotes, and trailing periods) into `src/strings.ts`, then replace the original literal with the reference. Where the original built one text from several concatenated literals, the resource holds the single joined string.

---

### Task 1: The strings module

**Files:**
- Create: `src/strings.ts`
- Test: `tests/strings.test.ts`

**Interfaces:**
- Consumes: `Violation` type from `src/types.ts` (type-only, if needed — otherwise nothing).
- Produces: `export const strings` with EXACTLY this shape (all values transcribed per the transcription rule; sources named per group):

```typescript
export const strings = {
  tools: {
    // Source: src/tools/resolve.ts registerResolveTools(...)
    resolveProfile: {
      title: "Resolve profile",
      description: "<full description text currently in resolve.ts>",
      inputs: {
        kind: "<current .describe text>",
        vendor: "<current .describe text>",
        name: "<current .describe text>",
      },
    },
    // Source: src/tools/write.ts registerWriteTools(...)
    writeProfile: {
      title: "Write profile",
      description: "<...>",
      inputs: { kind: "<...>", vendor: "<...>", name: "<...>", baseProfile: "<...>", kvps: "<...>", outputDir: "<...>" },
    },
    // Source: src/tools/update.ts registerUpdateTool(...)
    updateProfile: {
      title: "<current title>",
      description: "<...>",
      inputs: { kind: "<...>", name: "<...>", outputDir: "<...>", set: "<...>", remove: "<...>" },
    },
    // Source: src/tools/init-config.ts registerInitConfigTool(...)
    initConfig: {
      title: "Initialize configuration",
      description: "<...>",
      inputs: { installDir: "<...>", userDataDir: "<...>", userId: "<...>" },
    },
    // Source: src/tools/list.ts (four register functions)
    listProfiles: { title: "List profiles", description: "<...>", inputs: { kind: "<...>", vendor: "<...>", search: "<...>" } },
    listVendors: { title: "List vendors", description: "<...>" },
    listParameters: { title: "List parameters", description: "<...>", inputs: { kind: "<...>", search: "<...>" } },
    listFilaments: { title: "List filaments", description: "<...>" },
  },
  errors: {
    // Source: src/errors.ts — each function returns the exact current message
    vendorNotFound: (vendor: string): string => `...`,
    profileNotFound: (kind: string, name: string): string => `...`,
    circularInheritance: (chain: string[]): string => `...`,
    schemaValidation: (violations: { key: string; reason: string }[]): string => `...`, // header line + "- key: reason" lines, exactly as errors.ts builds it
    configMissing: "<current ConfigMissingError message>",
  },
  violations: {
    // Source: src/validator.ts checkScalar/checkValue + src/tools/write.ts + src/tools/update.ts reason literals
    unknownKey: "<current text>",
    reservedKeyWrite: "<current write.ts reserved-key reason>",
    reservedKeyUpdate: "<current update.ts reserved-key reason>",
    bothSetAndRemove: "<current update.ts overlap reason>",
    keyNotPresent: "<current update.ts not-present reason>",
    expectedString: (got: unknown): string => `...`,
    expectedEnum: (allowed: string[], got: unknown): string => `...`,
    expectedBool: (got: unknown): string => `...`,
    expectedNumeric: (typeLabel: string, got: unknown): string => `...`, // typeLabel is the "an integer" / "a float" / "a percent" phrase the caller builds today
    belowMinimum: (value: number, min: number): string => `...`,
    aboveMaximum: (value: number, max: number): string => `...`,
    expectedVector: (type: string, got: unknown): string => `...`,
    expectedScalar: (type: string): string => `...`,
    element: (index: number, reason: string): string => `...`,
  },
  warnings: {
    // Source: src/index.ts warnIfUnconfigured — stderr line and notification data text
    unconfiguredStderr: "<current stderr line>",
    unconfiguredNotification: "<current notification data text>",
  },
  messages: {
    // Source: src/tools/init-config.ts
    detectionFailed: (missing: string[]): string => `...`, // current two-part sentence using missing.join(", ") and missing.join(" and ")
    userIdNotDetected: (confPath: string): string => `...`,
    // Source: src/tools/update.ts
    nothingToDo: "<current text>",
    sourceNotFound: (path: string): string => `...`,
    sourceNotReadable: (path: string): string => `...`,
    sourceNotJson: (path: string): string => `...`,
    sourceNotObject: (path: string): string => `...`,
    // Source: src/validator.ts loadSchema
    schemaFileMissing: (path: string): string => `...`,
    schemaFileInvalid: (path: string): string => `...`,
  },
  formats: {
    // Source: src/tools/deps.ts toToolError
    toolError: (message: string): string => `Error: ${message}`,
  },
} as const;
```

The `<...>` markers above mean "transcribe the current literal from the named source file" — they are transcription instructions for the implementer, not content decisions. If a current literal does not fit a listed key (or a listed key has no matching literal), STOP and escalate to the controller instead of inventing or dropping entries.

- [ ] **Step 1: Write the failing test `tests/strings.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { strings } from "../src/strings.js";

describe("strings module", () => {
  it("exposes the top-level groups", () => {
    for (const group of ["tools", "errors", "violations", "warnings", "messages", "formats"] as const) {
      expect(strings[group]).toBeTypeOf("object");
    }
  });

  it("interpolates parameterized messages", () => {
    expect(strings.errors.vendorNotFound("BBL")).toContain("BBL");
    expect(strings.errors.profileNotFound("process", "X")).toContain("X");
    expect(strings.errors.circularInheritance(["a", "b", "a"])).toContain("a");
    expect(strings.violations.element(2, "bad")).toContain("2");
    expect(strings.violations.element(2, "bad")).toContain("bad");
    expect(strings.messages.userIdNotDetected("C:\\x\\BambuStudio.conf")).toContain("BambuStudio.conf");
    expect(strings.formats.toolError("boom")).toBe("Error: boom");
  });

  it("keeps ConfigMissingError guidance intact", () => {
    expect(strings.errors.configMissing).toContain("init_config");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/strings.test.ts`
Expected: FAIL — cannot resolve `../src/strings.js`.

- [ ] **Step 3: Create `src/strings.ts`**

Build the module with the exact shape from Produces, transcribing every text from the named source files per the transcription rule. Do not modify the source files yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/strings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + build sanity**

Run: `npm run build && npm test`
Expected: build clean; all existing tests still pass (nothing consumed the module yet).

- [ ] **Step 6: Commit**

```bash
git add src/strings.ts tests/strings.test.ts
git commit -m "feat: typed string resource module"
```

---

### Task 2: Wire errors, validator, and deps

**Files:**
- Modify: `src/errors.ts`, `src/validator.ts`, `src/tools/deps.ts`

**Interfaces:**
- Consumes: `strings` from Task 1.
- Produces: same public API as today; the classes/functions now source their texts from `strings`.

- [ ] **Step 1: Rewire `src/errors.ts`**

Each error class constructor passes the corresponding `strings.errors.*` value/result to `super(...)`. `SchemaValidationError` uses `strings.errors.schemaValidation(violations)`. Class names, fields, and export list unchanged.

- [ ] **Step 2: Run the covering tests**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS unchanged (3 tests) — proves byte-identity for error messages.

- [ ] **Step 3: Rewire `src/validator.ts`**

`loadSchema`'s two error messages come from `strings.messages.schemaFileMissing/schemaFileInvalid`; every reason literal in `checkScalar`/`checkValue`/`validateKvps` comes from the matching `strings.violations.*` entry. The `element <i>: <reason>` composition uses `strings.violations.element`.

- [ ] **Step 4: Run the covering tests**

Run: `npx vitest run tests/validator.test.ts`
Expected: PASS unchanged.

- [ ] **Step 5: Rewire `src/tools/deps.ts`**

`toToolError` builds its text via `strings.formats.toolError(message)`.

- [ ] **Step 6: Full suite**

Run: `npm run build && npm test`
Expected: build clean; every test passes unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts src/validator.ts src/tools/deps.ts
git commit -m "refactor: errors, validator, and tool-error format read from strings module"
```

---

### Task 3: Wire the tool modules and server entry

**Files:**
- Modify: `src/tools/resolve.ts`, `src/tools/write.ts`, `src/tools/update.ts`, `src/tools/init-config.ts`, `src/tools/list.ts`, `src/index.ts`

**Interfaces:**
- Consumes: `strings` from Task 1.
- Produces: same tool registrations; all titles, descriptions, `.describe(...)` texts, ad-hoc handler `Error` messages, and the two unconfigured-warning texts come from `strings`.

- [ ] **Step 1: Rewire the five tool modules**

Per module: `title` ← `strings.tools.<tool>.title`; `description` ← `strings.tools.<tool>.description`; each zod `.describe(...)` ← `strings.tools.<tool>.inputs.<param>`; reserved-key/overlap/not-present reasons ← `strings.violations.*`; init-config's two thrown `Error` messages ← `strings.messages.detectionFailed(missing)` / `strings.messages.userIdNotDetected(confPath)`; update's four thrown messages ← `strings.messages.nothingToDo/sourceNotFound/sourceNotJson/sourceNotObject`.

- [ ] **Step 2: Run the covering tests**

Run: `npx vitest run tests/tools-resolve.test.ts tests/tools-write.test.ts tests/tools-update.test.ts tests/tools-init-config.test.ts tests/tools-list.test.ts`
Expected: PASS unchanged.

- [ ] **Step 3: Rewire `src/index.ts`**

`warnIfUnconfigured` reads `strings.warnings.unconfiguredStderr` / `strings.warnings.unconfiguredNotification`.

- [ ] **Step 4: Full suite + literal sweep**

Run: `npm run build && npm test`
Expected: build clean; all tests pass unchanged.

Run (verification, PowerShell): `Select-String -Path src\tools\*.ts,src\errors.ts,src\validator.ts,src\index.ts -Pattern 'describe\("' `
Expected: no matches (every `.describe(...)` now takes a strings reference, not a literal). Manually skim the six modified files for leftover user-facing literals; the only allowed remaining literals are non-user-facing (keys, paths, JSON field names, log tags).

- [ ] **Step 5: Commit**

```bash
git add src/tools/ src/index.ts
git commit -m "refactor: tool definitions and warnings read from strings module"
```

---

## Self-Review Notes

- Spec coverage: module + leaf constraint (Task 1), full inventory migration (Tasks 2-3 cover every location the spec lists), byte-identity via untouched test suite (all tasks), no-new-literals rule stated in Global Constraints.
- The `<...>` transcription markers are deliberate: the source of truth for every text is the current code, named per entry; inventing content here would risk drift.
- Concurrency boundary with the reauthoring plan stated in Global Constraints.
