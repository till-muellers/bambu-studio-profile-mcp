# printing-profile-mcp — String Resource Decoupling

## Purpose

All user-facing strings the server emits live in one typed resource
module, `src/strings.ts`. Code references strings by name; the texts are
collected, reviewed, and changed in one place, independently of the logic
that emits them.

## Approach

A TypeScript resource module, not a JSON file and not an i18n framework:
the server has a single locale and its strings are parameterized, so the
requirements are type safety, compile-time completeness, and typed
interpolation — a `const`-typed module delivers all three; JSON would
lose them and an i18n library adds runtime machinery nothing consumes.

`src/strings.ts` is a leaf module: it imports nothing from `src/` (type
imports from `./types.js` are allowed) and every other module imports
from it. Static texts are `string` constants; every parameterized message
is a named function taking typed arguments and returning `string`.

## Structure

```typescript
export const strings = {
  tools: {
    resolveProfile: {
      title: "Resolve profile",
      description: "...",
      inputs: { kind: "...", vendor: "...", name: "..." },
    },
    writeProfile: { /* title, description, inputs.* */ },
    updateProfile: { /* ... */ },
    initConfig: { /* ... */ },
    listProfiles: { /* ... */ },
    listVendors: { /* ... */ },
    listParameters: { /* ... */ },
    listFilaments: { /* ... */ },
  },
  errors: {
    vendorNotFound: (vendor: string) => `...`,
    profileNotFound: (kind: string, name: string) => `...`,
    circularInheritance: (chain: string[]) => `...`,
    schemaValidationHeader: "...",
    configMissing: "...",
  },
  violations: {
    unknownKey: "...",
    reservedKey: "...",
    reservedKeyUpdate: "...",
    bothSetAndRemove: "...",
    keyNotPresent: "...",
    expectedString: (got: unknown) => `...`,
    expectedEnum: (allowed: string[], got: unknown) => `...`,
    expectedBool: (got: unknown) => `...`,
    expectedNumeric: (type: string, got: unknown) => `...`,
    belowMinimum: (value: number, min: number) => `...`,
    aboveMaximum: (value: number, max: number) => `...`,
    expectedVector: (type: string, got: unknown) => `...`,
    expectedScalar: (type: string) => `...`,
    element: (index: number, reason: string) => `...`,
  },
  warnings: {
    unconfiguredStderr: "...",
    unconfiguredNotification: "...",
  },
  messages: {
    detectionFailed: (missing: string[]) => `...`,
    userIdNotDetected: (confPath: string) => `...`,
    nothingToDo: "...",
    sourceNotFound: (path: string) => `...`,
    sourceNotJson: (path: string) => `...`,
    sourceNotObject: (path: string) => `...`,
    schemaFileMissing: (path: string) => `...`,
    schemaFileInvalid: (path: string) => `...`,
  },
} as const;
```

Exact grouping and naming may be refined during implementation; the
binding rules are: one module, leaf position, typed functions for every
parameterized message, and no string identity spread across files.

## Inventory to migrate

Every literal in these locations moves to `src/strings.ts`:

- Tool titles, descriptions, and every zod `.describe(...)` text:
  `src/tools/resolve.ts`, `src/tools/write.ts`, `src/tools/update.ts`,
  `src/tools/init-config.ts`, `src/tools/list.ts`.
- Error-class messages: `src/errors.ts` (all five classes; the
  `SchemaValidationError` message header and its per-violation line
  format).
- Violation reasons: `src/validator.ts` and the reserved-key /
  overlap / not-present reasons in `src/tools/write.ts` and
  `src/tools/update.ts`.
- Ad-hoc `Error` messages in handlers: `src/tools/init-config.ts`
  (detection failure, userId auto-detection failure),
  `src/tools/update.ts` (nothing-to-do, missing/unparseable source).
- Unconfigured warning texts (stderr line and MCP logging notification
  payload): `src/index.ts`.
- `toToolError`'s `Error: <message>` prefix format: `src/tools/deps.ts`.

Out of the migration's scope: `scripts/generate-schema/**` (developer
CLI, not server output), test files and fixtures, README and docs, and
the generated `schema/*.schema.json` contents (data, governed by the
description-reauthoring spec).

## Constraints

- Pure refactor: every emitted string is byte-identical before and after
  the move. The existing test suite passes unchanged — it is the
  regression net; no test may be edited to make the migration pass.
- `src/types.ts` and the public handler signatures are unchanged.
- After the migration, introducing a user-facing string outside
  `src/strings.ts` is a defect. Code review enforces this; no lint rule
  is added.

## Testing

- The unchanged existing suite (message-content assertions in
  errors/validator/tools/server tests) verifies string identity.
- One new test: `src/strings.ts` type-checks as a leaf (import cycle
  freedom is enforced by the compiler; the test asserts the module
  exports the `strings` object and that representative parameterized
  functions interpolate their arguments).

## Out of scope

- Localization / multiple locales.
- Changing any string's wording (that is ordinary follow-up work once
  the strings live in one place).
- Schema `label`/`description` data (see the description-reauthoring
  spec).
