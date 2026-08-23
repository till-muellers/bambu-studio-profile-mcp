# printing-profile-mcp — Design

## Purpose

Bambu Studio process and filament profiles are JSON files that inherit from
other JSON files; resolving a profile's active settings requires walking
that inheritance chain, and writing a profile requires knowing the valid
keys/types (Bambu Studio ships no formal schema for this). This MCP server
exposes tools to resolve fully-merged process/filament settings, to
create schema-validated profile files in a caller-chosen output directory,
and to install such files into (or remove them from) Bambu Studio's own
user preset store.

Out of scope: any cloud-side call to Bambu Lab's servers (create, update,
delete, or conflict resolution — these tools only ever touch the local
filesystem); machine/printer profiles; bulk import/remove of multiple
presets in one call; migrating presets between `userId` folders.

## Data sources

Bambu Studio directories are read-only for this server, with one
exception: `import_profile` and `remove_profile` write to and delete from
`<userDataDir>/user/<userId>/{process,filament}` under the safety
contracts in their tool sections. The system store
(`<installDir>/resources/...`) is never written under any circumstance.

- **`<installDir>/resources/profiles/<vendor>/{process,filament}`** — system
  presets shipped with Bambu Studio, organized per vendor (BBL and
  third-party vendors). Root of most inheritance chains. Profiles are
  identified by the `name` field inside each JSON file.
- **`<installDir>/resources/profiles_template`** — templates usable as a
  starting point when creating new profiles.
- **`<userDataDir>/user/<userId>/{process,filament}`** — the user's own
  customized presets, each storing only the keys that differ from its
  `inherits` parent. Multiple `<userId>` directories can coexist (a numeric
  cloud-account id plus `default`); resolution reads ONLY the `<userId>`
  configured in `config.json`.

A profile's `inherits` field may point to another user preset or to a
system preset; the resolver must be able to cross from the user store back
into `resources/profiles`.

Written profiles go to an `outputDir` provided per write call; installing
one into the user preset store is a separate, explicit `import_profile`
call.

## User preset format

Facts about Bambu Studio's user preset store (source-verified against
BambuStudio v02.07.00.55 and real presets) that bind the import/remove
tools:

- A user preset JSON carries, beyond `name`/`inherits`/settings:
  `"from": "User"`; `"version"` (a Bambu Studio version stamp);
  `"print_settings_id": "<name>"` (process, scalar) or
  `"filament_settings_id": ["<name>"]` (filament, one-element array).
- Each preset may have a `<name>.info` sidecar: INI-style `key = value`
  lines with CRLF line endings, fields in order `sync_info`, `user_id`,
  `setting_id`, `base_id`, `updated_time` (Unix epoch seconds).
- `setting_id`/`base_id` are cloud-assigned (via Bambu's closed network
  plugin, requires login). This server never synthesizes them — they stay
  empty on anything it writes.
- `sync_info` values `create`/`update` mark a preset for cloud upload by
  Bambu Studio's sync loop; empty means no pending sync. This server
  always writes it empty, so imported presets are never auto-uploaded.
- A preset JSON without a sidecar (or with an empty one) loads as an
  ordinary local, unsynced preset. A preset JSON Bambu Studio cannot
  parse is DELETED by Bambu Studio at startup, together with its sidecar
  — pre-import validation is a data-safety requirement, not a courtesy.
- Bambu Studio rescans the store only at startup and on login/logout; it
  has no filesystem watcher. Imports and removals become visible after a
  Bambu Studio restart.

## Value serialization

Verified against a real Bambu Studio 2.7.0.8 installation:

- Scalar options are stored as bare JSON strings: `"layer_height": "0.1"`,
  `"sparse_infill_density": "100%"`.
- Vector options (per-extruder / per-filament values) are stored as string
  arrays with one element per position of the target profile's own
  flattened (extruder × hotend-variant) list, as enumerated by that
  profile's `print_extruder_variant` (process) or `filament_extruder_variant`
  (filament) array — e.g. `"outer_wall_speed": ["200", "500", "500"]` for a
  3-position profile. This length varies by printer AND resources version;
  it is never a fixed constant (observed lengths: A1=1, X1C=2, P2S=3,
  H2D=7). Writing a vector shorter than the target's variant list is
  accepted by Bambu Studio, which broadcast-resizes it (repeating the last
  value) — legal but usually unintended; real profiles always ship
  full-length vectors.
- `"nil"` as a vector element means "keep the base/printer value at this
  position". It is legal only on options the schema marks
  `nullable: true` (Bambu Studio's own `def->nullable = true;`); real user
  presets contain entries like
  `"filament_flow_ratio": ["0.9576","nil","nil"]`.

Every schema entry therefore carries a `vector` flag, and nullable options
additionally carry a `nullable: true` flag. Validation of a scalar option
rejects arrays; validation of a vector option requires an array of at
least one element and validates every element — except that the exact
string `"nil"` is always accepted as an element (or as the scalar value)
on an option with `nullable: true`. Array length itself remains
unvalidated.

## Schema

Bambu Studio's valid option keys, types, enums, and ranges live in its C++
config-option definitions, not in a shipped JSON Schema. A one-time,
manually re-run offline script (`scripts/generate-schema/`) parses a
BambuStudio source checkout and emits two files checked into this repo:

- `schema/process.schema.json`
- `schema/filament.schema.json`

Each maps option key → `{ type, vector, enum?, min?, max?, default?, label?, description?, nullable? }`.
Types: `string`, `int`, `float`, `bool`, `enum`, `percent`. `label` and
`description` come from Bambu Studio's own `def->label`/`def->tooltip`
strings and are omitted when the source declares neither. The MCP server
only ever reads these two files at runtime; it never parses C++ or touches
a BambuStudio source checkout itself.

The checkout is obtained by shallow-cloning
`https://github.com/bambulab/BambuStudio` at the release tag matching the
installed Bambu Studio version (read from a user preset's `version` field;
currently 2.7.0.8). Re-run the generator after Bambu Studio updates.

## Path configuration

`config.json` stores three values:

```json
{ "installDir": "string", "userDataDir": "string", "userId": "string" }
```

It lives at `<configDir>/config.json`, where `configDir` resolves at server
start (first match wins):

1. `BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR` env var — used as the config directory
   verbatim, no subdirectory appended.
2. `CLAUDE_PROJECT_DIR` env var (set by Claude Code for stdio MCP servers) —
   config dir is `<CLAUDE_PROJECT_DIR>/.bambu-studio-profile-mcp`.
3. `process.cwd()` — fallback; config dir is `<cwd>/.bambu-studio-profile-mcp`.

The resulting directory is per-project and gitignored (`.bambu-studio-profile-mcp/`).

- `installDir` — contains `resources/profiles` and
  `resources/profiles_template`.
- `userDataDir` — contains the `user/` preset store
  (`%APPDATA%\BambuStudio` on Windows).
- `userId` — the `user/<userId>` directory resolution reads.

There is no zero-config operation: until `config.json` exists, every
tool call except `init_config` fails with an error directing the caller
to `init_config`. All three of `installDir`, `userDataDir`, and `userId` may
be omitted from the `init_config` call:

- `installDir`/`userDataDir` are filled by best-effort per-OS
  auto-detection (on Windows, via the registry uninstall entry, since the
  install drive varies).
- `userId` is filled by reading `app.preset_folder` from
  `<userDataDir>\BambuStudio.conf` — the logged-in account's preset
  folder name. Detection runs only after `installDir`/`userDataDir` are
  resolved, since the conf path depends on `userDataDir`. If `userId` is
  omitted and the conf file is missing, unparseable, or has no
  `app.preset_folder`, the call fails with an error naming the conf path
  it tried and directing the caller to pass `userId` explicitly.

Any of the three may still be given explicitly as an override (e.g. to
target the `default` folder instead of a cloud-account id). Vendor is
always an explicit argument on every tool call, keeping tools stateless.

## Tools

### `resolve_profile`

Resolve a process or filament profile's fully-merged active settings.

**Input**
```json
{ "kind": "process | filament", "vendor": "string", "name": "string" }
```

**Output**
```json
{
  "vendor": "string",
  "name": "string",
  "kind": "process | filament",
  "chain": ["string", "..."],
  "settings": { "<key>": "<value>", "...": "..." }
}
```
`chain` lists the profiles walked from root to `name` (for traceability).
`settings` is the flat merged key→value map after applying each link in the
chain in order; values pass through with their on-disk serialization
(bare strings, vectors) untouched. `name` and `inherits` are excluded.

**Errors**: vendor not found; profile not found for vendor; circular or
unresolvable `inherits` chain; paths not configured (fix via
`init_config`).

### `write_profile`

Create or update a process or filament profile file in a caller-chosen
directory. Same tool handles both: if `<outputDir>/<name>.json` already
exists, it is overwritten; otherwise it is created. `outputDir` is created
if missing.

**Input**
```json
{
  "kind": "process | filament",
  "vendor": "string",
  "name": "string",
  "baseProfile": "string",
  "kvps": { "<key>": "<value>", "...": "..." },
  "outputDir": "string"
}
```
`baseProfile` is the profile `name` inherits from (must resolve
successfully via the same lookup as `resolve_profile`). `kvps` are
the only keys written besides `name` and `inherits` — no full snapshot.
The written file body is exactly `{ "name": ..., "inherits": ...,
...kvps }`, pretty-printed. Overwriting REPLACES the previous content
wholesale — `kvps` is always the complete override set; use
`update_profile` to change an existing file incrementally.

Every key in `kvps` is validated against `schema/<kind>.schema.json`
before anything is written: the key must exist in the schema, and its
value must match the declared type/enum/range. Scalar options reject
arrays; vector options require an array and validate each element. All
violations are collected and reported together, not just the first one
found. Nothing is written if any check fails.

**Output**
```json
{
  "vendor": "string",
  "name": "string",
  "kind": "process | filament",
  "created": true,
  "path": "string",
  "inherits": "string",
  "overrides": { "<key>": "<value>", "...": "..." }
}
```
`created` is `true` for a new file, `false` when an existing file was
overwritten. `path` is `<outputDir>/<name>.json`.

**Errors**: `baseProfile` not found; one or more `kvps` entries fail schema
validation (key unknown, wrong type/shape, out of range/enum) — reported
as a list of `{ key, reason }`, not just the first failure; paths not
configured (fix via `init_config`).

### `update_profile`

Incrementally edit a profile file previously created by `write_profile`:
upsert `set` keys and delete `remove` keys in one atomic, validated step.
Keys not mentioned stay unchanged; the file's `name` and `inherits` stay
as they are.

**Input**
```json
{
  "kind": "process | filament",
  "name": "string",
  "outputDir": "string",
  "set": { "<key>": "<value>", "...": "..." },
  "remove": ["string", "..."]
}
```
At least one of `set` (non-empty) / `remove` (non-empty) must be given.
`set` values follow the same rules as `write_profile`'s `kvps` (scalar
strings, full-length vector arrays, `"nil"` on nullable options).

Every violation is collected together before anything is written:
`name`/`inherits` appearing in `set` or `remove` (reserved, managed via
`write_profile`'s `name`/`baseProfile` arguments); `set` entries failing
schema validation; `remove` entries not present as a key in the file.

**Output**
```json
{
  "name": "string",
  "kind": "process | filament",
  "path": "string",
  "set": ["string", "..."],
  "removed": ["string", "..."],
  "overrides": { "<key>": "<value>", "...": "..." }
}
```
`set`/`removed` are the applied key lists; `overrides` is the file's
final key→value map excluding `name`/`inherits`.

**Errors**: `<outputDir>/<name>.json` not found (create it with
`write_profile` first); schema violations, reserved keys, and unknown
`remove` keys listed together; nothing to do when both `set` and `remove`
are omitted; config missing (run `init_config` first).

### `import_profile`

Install a profile file previously written by `write_profile` into Bambu
Studio's user preset store, `user/<userId>/<kind>/`.

**Input**
```json
{
  "kind": "process | filament",
  "vendor": "string",
  "outputDir": "string",
  "name": "string",
  "overwrite": false
}
```
`outputDir`/`name` locate the source file `<outputDir>/<name>.json`, the
same addressing `update_profile` uses. `vendor` names the system store the
source's `inherits` chain is resolved against, as on every other tool.

**Behavior**

1. Read the source file; re-validate every override key/value against
   `schema/<kind>.schema.json` (same rules as `write_profile`, including
   `"nil"` on nullable options). This guards against hand-edited files —
   Bambu Studio deletes unparseable presets at startup.
2. Resolve the file's `inherits` target via the same lookup as
   `resolve_profile` (proves the chain is sound).
3. Build the preset body: source content plus `from: "User"`, `version`
   (the `version` key of the `inherits` target's resolved merged
   settings — the most specific chain member that declares one; omitted
   when the chain carries none), and
   `print_settings_id`/`filament_settings_id` derived from `name` per the
   kind's convention.
4. Write `<userDataDir>/user/<userId>/<kind>/<name>.json` and a minimal
   `<name>.info` sidecar: `sync_info`, `user_id`, `setting_id`, `base_id`
   empty; `updated_time` = current epoch seconds; CRLF line endings.

**Overwrite contract**

- `overwrite: false` (default): an existing `<name>.json` in the target
  store fails the call, naming the existing path; nothing is written.
- `overwrite: true`: the existing JSON+`.info` pair is replaced. Before
  replacing, the existing JSON's own `from` field must be `"User"` —
  a target whose `from` differs is refused regardless of flags (hard
  safety boundary). No backup is taken; imported content originates from
  the caller's versioned `outputDir` files.
- The system store is never touched.

**Output**
```json
{
  "kind": "process | filament",
  "name": "string",
  "path": "string",
  "infoPath": "string",
  "overwritten": false,
  "note": "Bambu Studio picks this up after a restart."
}
```

**Errors**: source `<outputDir>/<name>.json` missing or unparseable;
schema violations listed per key (like `write_profile`); vendor not
found; `inherits` target not found or unresolvable; target exists
without `overwrite`;
target exists but its `from` is not `"User"` (refusal, not bypassable);
config missing (run `init_config` first). All problems found before any
write are collected and reported together.

### `remove_profile`

Delete a user preset (JSON plus `.info` sidecar) from
`user/<userId>/<kind>/`.

**Input**
```json
{ "kind": "process | filament", "name": "string" }
```

**Behavior**

1. Locate `<userDataDir>/user/<userId>/<kind>/<name>.json`; read it and
   require `"from": "User"` — anything else is refused (hard safety
   boundary, not bypassable).
2. Read the `.info` sidecar when present: a non-empty `setting_id` means
   a cloud record exists for this preset; the removal proceeds, and the
   result carries `cloudRecord: true` with a warning that Bambu Studio's
   sync may restore the preset.
3. Delete the JSON and sidecar together. A missing sidecar is reported
   in the result, not an error. A stray `.info` without its JSON is an
   error naming both paths checked.

**Output**
```json
{
  "kind": "process | filament",
  "name": "string",
  "removedJson": "string",
  "removedInfo": "string | null",
  "cloudRecord": false,
  "note": "Bambu Studio picks this up after a restart."
}
```

**Errors**: `<name>.json` not found in the user store; found but `from`
is not `"User"` (refusal); stray sidecar without JSON; config missing
(run `init_config` first).

### `list_profiles`

Discover profiles of the given `kind` in the user preset store and,
optionally, the system store.

**Input**
```json
{ "kind": "process | filament", "vendor": "string (optional)", "search": "string (optional)" }
```
`vendor` scopes system results to one vendor folder; omitted, every vendor
subdirectory of `resources/profiles` is scanned. `search` narrows the
result by a case-insensitive substring match on `name`.

**Output**
```json
{
  "kind": "process | filament",
  "profiles": [
    { "name": "string", "source": "user | system", "vendor": "string (system only)", "inherits": "string (optional)" }
  ]
}
```
User entries are listed first, then system entries sorted by vendor then
name.

**Errors**: vendor not found (only when `vendor` is given); paths not
configured (fix via `init_config`).

### `list_vendors`

List the vendor folder ids under `resources/profiles` with their display
names, for discovering valid `vendor` arguments to the
resolve/write/list_profiles tools.

**Input**: none.

**Output**
```json
{ "vendors": [{ "id": "string", "name": "string" }] }
```
`id` is the folder name; `name` is the sibling
`resources/profiles/<id>.json` metadata file's top-level `name` field, or
`id` when that file is absent/unparseable/nameless. Sorted by `id`.

**Errors**: paths not configured (fix via `init_config`).

### `list_parameters`

Discover the option keys valid for `kind` profiles, enriched with the
schema's `label`/`description` where present.

**Input**
```json
{ "kind": "process | filament", "search": "string (optional)" }
```
`search` narrows the result by a case-insensitive substring match against
the key, label, and description.

**Output**
```json
{
  "kind": "process | filament",
  "parameters": [
    {
      "key": "string",
      "type": "string | int | float | bool | enum | percent",
      "vector": true,
      "enum": ["string", "..."],
      "min": 0,
      "max": 0,
      "default": "...",
      "label": "string (optional)",
      "description": "string (optional)",
      "nullable": true
    }
  ]
}
```
`parameters` is ordered as the keys appear in `schema/<kind>.schema.json`.

**Errors**: paths not configured (fix via `init_config`).

### `list_filaments`

List the distinct `filament_id` values found across all filament profiles,
with display names: the configured user filament store plus every vendor's
system filament directory. Only profiles that carry a `filament_id`
contribute an entry.

**Input**: none.

**Output**
```json
{ "filaments": [{ "id": "string", "name": "string" }] }
```
`name` is the ` @...`-suffix-stripped `name` of the id's root carrier (a
profile with that id and no `inherits`), or of its shortest-named carrier
when no root carrier exists. Sorted by `id`, deduplicated.

**Errors**: paths not configured (fix via `init_config`).

### `init_config`

Set and persist the configuration. Required before any resolve/write call
succeeds.

**Input**
```json
{ "installDir": "string (optional)", "userDataDir": "string (optional)", "userId": "string (optional)" }
```
Omitted `installDir`/`userDataDir` are filled by per-OS auto-detection.
Omitted `userId` is filled by reading `app.preset_folder` from
`<userDataDir>\BambuStudio.conf`. If detection cannot supply a missing
value, the call fails naming it (for `userId`, naming the conf path it
tried).

**Output**
```json
{ "installDir": "string", "userDataDir": "string", "userId": "string", "persistedTo": "string" }
```

**Errors**: `installDir`/`userDataDir` undetectable or invalid;
`userDataDir` does not contain `user/<userId>`; `userId` omitted and
`<userDataDir>\BambuStudio.conf` is missing, unparseable, or has no
`app.preset_folder`. All problems are reported together; nothing is
persisted on failure.

On success, both the in-memory config for the running server and
`config.json` in the project folder are updated immediately — no restart
required for subsequent tool calls.

## Error handling

- Not-found vendor/profile/base profile → clear, specific error naming what
  was looked up.
- Schema violations → every invalid key/value reported together.
- Circular `inherits` chains → detected and rejected before returning
  partial results.
- Missing config → error naming `init_config` as the fix.
- Safety refusals (`from` is not `"User"` on an import overwrite or a
  removal target) are distinct from not-found errors: they name the file
  and the reason, and no input flag bypasses them.

## Testing

- Resolver merge logic against fixture inheritance chains (including a
  chain that crosses from a user preset back into a system preset).
- Fixtures mirror real serialization: bare-string scalars, percent
  strings, multi-element vector arrays.
- Schema validation against valid and invalid `kvps` inputs, including
  scalar-given-array, vector-given-scalar, and per-element vector
  violations.
- Writer output format (file location, `inherits`, minimal-keys-only body)
  against a temp output directory.
- Schema generator: light smoke test only, against a checked-in C++
  fixture snippet — not exhaustively tested.
- Import: metadata synthesis (`from`, `version` from the resolved chain,
  per-kind settings-id shape) and exact sidecar bytes (field order, CRLF)
  against a temp user store; overwrite refusal without the flag; `from`
  refusal even with the flag; nothing written on any validation failure.
- Remove: pair deletion; `from` refusal; missing-sidecar reporting;
  stray-sidecar error; `cloudRecord` flag driven by sidecar content.

## Tech stack

TypeScript / Node.js, using the official MCP TypeScript SDK
(`@modelcontextprotocol/sdk`).
