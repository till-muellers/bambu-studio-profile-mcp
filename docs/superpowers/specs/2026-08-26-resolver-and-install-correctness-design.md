# printing-profile-mcp — Resolver and Install Correctness

## Purpose

Five defects make the server report success while disagreeing with Bambu Studio. Each is silent:
the tool returns a well-formed result and the result is wrong. This design closes all five and
adds the check that would have caught the worst of them at the call site.

| Area | Defect |
|---|---|
| `import_profile` | writes no `version`; Studio refuses the preset without a word |
| resolver | ignores `include`; every filament resolve that uses one is wrong |
| `lint_profile` | measures every vector against the machine's column count |
| `lint_profile` | flags keys Studio unconditionally rewrites |
| `diff_profile` | reports `identical: true` for a preset Studio cannot load |

## Bambu Studio contracts

Verified against `bambulab/BambuStudio` at tag `v02.08.02.61`. These are the facts the design
rests on; each names the site that establishes it.

**Preset version.** `PresetBundle.cpp:4994,5244` — every system preset takes
`loaded.version = current_vendor_profile->config_version`, read from
`resources/profiles/<vendor>.json`'s `version` field (`PresetBundle.cpp:4673-4681`).
`Preset::save` writes `this->version.to_string()` (`Preset.cpp:690`). Semver parsing strips
leading zeros per component: the vendor index `"02.08.00.04"` becomes the preset `"2.8.0.4"`.

**Silent rejection.** `Preset.cpp:1425-1427` — `key_values[BBL_JSON_KEY_VERSION]` on a missing
key yields `""`, `Semver::parse("")` fails, and the load loop `continue`s. That branch logs
nothing. A user preset without a parseable `version` does not exist as far as Studio is concerned.

**Include.** `PresetBundle.cpp:4860-4899` — a preset's config is built as: the `inherits` parent's
resolved config, then each `include` target in listed order, then the file's own keys
(`config.apply(config_src)`, line 4908). Include targets are applied through
`apply_only(include_config, include_config.diff(default_config))`, so a key the target leaves at
the built-in default is not applied. Every include target in the BBL bundle carries multi-column
vectors only, and a multi-column vector can never equal a single-column built-in default —
applying every key of the target is therefore equivalent for all shipped data. The divergence
condition to watch: an include target that sets a key to the stock default while the `inherits`
parent sets it to something else.

**Per-variant options.** `PrintConfig.cpp` declares four key sets, selected per preset type by
`Preset::get_extruder_names_and_keysets` (`Preset.cpp:906-928`): `print_options_with_variant`,
`filament_options_with_variant`, `printer_options_with_variant_1` and `_2`. Only a key in its
kind's set is indexed by extruder variant. Every other vector option in a process or filament
preset carries one column.

**Structural keys.** `Preset.cpp:661-666` — on every save with a parent, Studio appends the kind's
extruder-id and extruder-variant keys to `dirty_options` regardless of whether they equal the
parent. A process preset therefore always carries `print_extruder_id` and `print_extruder_variant`;
a filament preset always carries `filament_extruder_variant`.

## Vendor version

`src/profile-store.ts` gains a vendor-index reader that returns the normalized version for a
vendor: it reads `<installDir>/resources/profiles/<vendor>.json`, takes `version`, and strips
leading zeros from each dot-separated component.

`import_profile` takes `version` from that reader. When the vendor index is missing, unparseable,
carries no `version`, or carries one that does not normalize to a Semver, the import **fails and
writes nothing**. A preset without a version is invisible; writing one anyway is worse than an
error.

`resolvedBase.settings.version` is not a version source — system presets do not carry the key.

## Include resolution

`loadChain` returns the layers a merge consumes. It expands `include` while building that list:
for each layer, every name in its `include` array is resolved through the same store lookup, its
own chain and includes expanded recursively, and the resulting layers are spliced in immediately
before the layer's own keys. Merge order becomes parent chain → include targets in listed order →
own keys, matching Studio.

`"nil"` resolution needs no special case: an include target spliced in as an ordinary layer takes
its `"nil"` columns from what precedes it, which is what `mergeLayer` already does.

`ResolvedProfile` gains `included?: Record<string, string[]>` — layer name to the include targets
it pulled in, present only when some layer used one. A caller can see that a layer's shape came
from an include, the way `nilUnresolved` surfaces unresolved columns today.

A named include target that does not exist in the store fails the resolve with the same error a
missing `inherits` link raises. Studio logs and continues; this server does not hide a broken
chain behind a plausible result.

This fixes `resolve_profile`, `compare_profiles`, `lint_profile` and the machine-deferral path
together, because all four read the resolver.

## Column counts

`schema/*.schema.json` gains `perVariant` per option: true when the key is in its kind's
`*_options_with_variant` set. The flag is a parser fact, produced by
`scripts/generate-schema` from `PrintConfig.cpp` — the same run that produces `vector`.

The generator runs against the newest production BambuStudio release. The checkout at
`D:\repos\BambuStudio` tracks that release; `CLAUDE.md`'s schema-regeneration rule is restated to
match, replacing the installed-version rule.

`lint_profile`'s `column-count` check then measures a vector override against the machine's
`printer_extruder_variant.length` when `perVariant` is true, and against 1 otherwise. The check
no longer needs a machine name for non-per-variant keys, so it no longer skips wholesale when
`machineName` is absent — it skips only the per-variant keys, and says so.

## Structural key exemptions

`parent-equal-override` never reports `print_extruder_id` or `print_extruder_variant` on a process
preset, or `filament_extruder_variant` on a filament preset. Studio rewrites them on every save;
removing them produces permanent drift.

`import_profile` writes those keys, taken from the resolved parent chain, so an installed preset
matches what Studio would write and the first Studio save produces no drift. The filament case
depends on include expansion: `filament_extruder_variant` on a P2S 0.2 filament preset resolves to
one column from the `inherits` chain alone and to two once its include is applied.

## Loadability

A shared predicate answers one question: would Studio load this installed preset? It holds when
the file parses, carries a `version`, and that `version` parses as a Semver.

Studio additionally rejects a preset whose major version exceeds the running application's
(`Preset.cpp:1428-1431`). The server does not know the running application's version, so the
predicate does not evaluate that condition. Presets this server writes take the vendor bundle's
version, which the installed Studio ships, so the condition cannot be the cause of a rejection for
them.

`diff_profile` gains `loadable: boolean` plus a reason when false. `identical: true` can no longer
be read as "installed and working" while the preset is invisible.

`import_profile` verifies what it wrote before reporting success, and reports the keys it actually
wrote. The note reports written keys, never keys stripped from the source.

`STUDIO_RESTART_NOTE` states only what holds: a restart is required, and it is not sufficient on
its own — a preset whose `compatible_printers` excludes the selected machine stays hidden.

## Contracts

`src/types.ts` is a locked contract; these are additive and need review:

- `SchemaOption.perVariant?: boolean`
- `ResolvedProfile.included?: Record<string, string[]>`

`src/errors.ts` gains the error the vendor-version failure raises.

All new user-facing text lives in `src/strings.ts`.

## Testing

- Vendor version: normalization of `02.08.00.04` → `2.8.0.4`; import fails and writes nothing when
  the vendor index has no usable version; an imported preset's `version` parses as a Semver. The
  regression test the current suite lacks: import against a parent chain carrying no `version`.
- Include: a fixture chain where an include target supplies a key the `inherits` chain lacks, one
  where the file's own keys override the include, one where the include overrides the parent, one
  where an include target carries `"nil"` columns filled from the parent, and one whose include
  target is missing.
- Column counts: a filament fixture whose non-per-variant vectors are single-column produces no
  `column-count` finding against a multi-variant machine; a per-variant key at the wrong length
  still does.
- Structural keys: `parent-equal-override` stays silent on the exempt keys per kind; import writes
  them.
- Loadability: `diff_profile` reports `loadable: false` with `identical: true` for an installed
  preset stripped of its `version`.
- Protocol-level tests in `tests/server.test.ts` for every changed tool result shape.

## Out of scope

Output-shaping parameters (`mode`, `quiet`, `checks`, `fields`, `instantiableOnly`, multi-name
resolve) are a separate design.

`filament_flush_temp_fast` ships in the BBL vendor bundle and is absent from
`schema/filament.schema.json`. Regenerating the schema against the newest production release
resolves it as a side effect; no separate work item.
