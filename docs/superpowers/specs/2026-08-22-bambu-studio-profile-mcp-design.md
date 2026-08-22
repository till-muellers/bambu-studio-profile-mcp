# printing-profile-mcp — Design

## Purpose

Bambu Studio process and filament profiles are JSON files that inherit from
other JSON files; resolving a profile's active settings requires walking
that inheritance chain, and writing a profile requires knowing the valid
keys/types (Bambu Studio ships no formal schema for this). This MCP server
exposes tools to resolve fully-merged process/filament settings and to
create or update process/filament presets in a schema-validated way.

Out of scope: mapping JSON keys to their GUI display names, and any
"explain what a setting does" tool. Both are deferred to a later project.

## Data sources

- **`<installDir>/resources/profiles/<vendor>/{process,filament}`** — system
  presets shipped with Bambu Studio, organized per vendor (BBL and
  third-party vendors). Root of most inheritance chains.
- **`<installDir>/resources/profiles_template`** — templates usable as a
  starting point when creating new profiles.
- **`<userDataDir>/user/<id>/{process,filament}`** (or equivalent, exact
  layout confirmed during implementation) — the user's own customized
  presets, each typically storing only the keys that differ from its
  `inherits` parent. This is where new/updated presets are written.

A profile's `inherits` field may point to another user preset or to a
system preset; the resolver must be able to cross from the user store back
into `resources/profiles`.

## Schema

Bambu Studio's valid option keys, types, enums, and ranges live in its C++
config-option definitions, not in a shipped JSON Schema. A one-time,
manually re-run offline script (`scripts/generate-schema/`) parses a local
BambuStudio source checkout and emits two files checked into this repo:

- `schema/process.schema.json`
- `schema/filament.schema.json`

Each maps option key → `{ type, enum?, min?, max?, default }`. The MCP
server only ever reads these two files at runtime; it never parses C++ or
touches a BambuStudio source checkout itself.

Bambu Studio profile JSON frequently serializes even scalar values as
single-element string arrays (e.g. a float stored as `["0.2"]`). The schema
generator must capture each option's actual on-disk serialization shape,
not just its C++ type, so that validation and merging agree with what the
files really contain. This is confirmed against real sample files during
implementation.

## Path configuration

The server needs two paths: `installDir` (containing `resources/profiles`
and `resources/profiles_template`) and `userDataDir` (containing the user
preset store).

1. On startup, if `config.json` exists in the project folder, its
   `installDir`/`userDataDir` are used as-is.
2. Otherwise, the server attempts per-OS auto-detection of Bambu Studio's
   default install and user-data locations.
3. If neither yields usable paths, `resolve_*`/`write_*` tool calls fail
   with an error directing the caller to `init_config`.

`config.json` lives in the project folder, is gitignored (machine-specific),
and stores paths only — no default vendor/printer. Vendor is always an
explicit argument on every tool call, keeping tools stateless.

## Tools

### `resolve_process_profile`

Resolve a process (print) profile's fully-merged active settings.

**Input**
```json
{ "vendor": "string", "name": "string" }
```

**Output**
```json
{
  "vendor": "string",
  "name": "string",
  "kind": "process",
  "chain": ["string", "..."],
  "settings": { "<key>": "<value>", "...": "..." }
}
```
`chain` lists the profiles walked from root to `name` (for traceability).
`settings` is the flat merged key→value map after applying each link in the
chain in order.

**Errors**: vendor not found; profile not found for vendor; circular or
unresolvable `inherits` chain.

### `resolve_filament_profile`

Same contract as `resolve_process_profile`, with `"kind": "filament"`,
resolved against filament profiles instead of process profiles.

### `write_process_profile`

Create or update a process preset in the user store. Same tool handles
both: if `name` already exists in the user's process presets, it is
overwritten; otherwise a new preset file is created.

**Input**
```json
{
  "vendor": "string",
  "name": "string",
  "baseProfile": "string",
  "kvps": { "<key>": "<value>", "...": "..." }
}
```
`baseProfile` is the profile `name` becomes `inherits` from (must resolve
successfully via the same lookup as `resolve_process_profile`). `kvps` are
the only keys written to the new/updated preset file — no full snapshot.

Every key in `kvps` is validated against `schema/process.schema.json`
before anything is written: key must exist in the schema, and its value
must match the schema's declared type/enum/range (accounting for Bambu
Studio's array-wrapped scalar serialization). All violations are collected
and reported together, not just the first one found.

**Output**
```json
{
  "vendor": "string",
  "name": "string",
  "kind": "process",
  "created": true,
  "path": "string",
  "inherits": "string",
  "overrides": { "<key>": "<value>", "...": "..." }
}
```
`created` is `true` for a new file, `false` when an existing preset was
overwritten.

**Errors**: `baseProfile` not found; one or more `kvps` entries fail schema
validation (key unknown, wrong type, out of range/enum) — reported as a
list of `{ key, reason }`, not just the first failure.

### `write_filament_profile`

Same contract as `write_process_profile`, with `"kind": "filament"`,
validated against `schema/filament.schema.json` and written to the user's
filament presets.

### `init_config`

Explicitly set and persist `installDir`/`userDataDir` when auto-detection
fails (or to override it).

**Input**
```json
{ "installDir": "string", "userDataDir": "string" }
```

**Output**
```json
{ "installDir": "string", "userDataDir": "string", "persistedTo": "string" }
```

**Errors**: `installDir` does not contain `resources/profiles`; `userDataDir`
does not look like a valid Bambu Studio user-data directory.

On success, both the in-memory config for the running server and
`config.json` in the project folder are updated immediately — no restart
required for subsequent tool calls.

## Error handling

- Not-found vendor/profile/base profile → clear, specific error naming what
  was looked up.
- Schema violations → every invalid key/value reported together.
- Circular `inherits` chains → detected and rejected before returning
  partial results.
- Missing/unusable paths (no config, auto-detection failed) → error naming
  `init_config` as the fix.

## Testing

- Resolver merge logic against fixture inheritance chains (including a
  chain that crosses from a user preset back into a system preset).
- Schema validation against valid and invalid `kvps` inputs, including the
  array-wrapped-scalar serialization case.
- Writer output format (file location, `inherits`, minimal-keys-only body)
  against fixtures.
- Schema generator: light smoke test only, not exhaustively tested.

## Tech stack

TypeScript / Node.js, using the official MCP TypeScript SDK
(`@modelcontextprotocol/sdk`).
