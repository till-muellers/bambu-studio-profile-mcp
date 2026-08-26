---
name: profile-authoring
description: Use when creating or editing a Bambu Studio process or filament preset — a new material entry, a tuning variant, or any parameter change destined for the slicer — before writing any preset JSON by hand.
---

# Profile Authoring

Author presets as schema-validated minimal-delta files through the bambu-profiles MCP,
then install them. Requires the project's `## Printing Workspace` section (run
profile-workspace-init first when it is missing); `init_config` once per session.

## Tool Decision Matrix

| Question | Tool | Note |
|---|---|---|
| First-run configuration | `init_config` | No arguments auto-detects everything; call it before the first profile tool call of a session |
| What profiles, vendors, or filament products exist? | `list_profiles`, `list_vendors`, `list_filaments` | `list_profiles` takes `search` and `source: "user"` / `"system"`; rows carry `name`, `source`, `vendor`, `inherits` |
| What does key X accept? | `list_parameters` | Returns `type`, `vector`, `enum`, `min`, `max`, `default`, `unit`, `label`, `description`, `nullable`; `search` matches key, label, and description |
| What value is in effect for an installed preset? | `resolve_profile` | `keys` projects the result; requested keys the profile lacks come back in `missingKeys` |
| …for a file not yet installed? | `resolve_from_file` | Same `keys` and `machineName`; `sourceName` when the file name differs from `name` |
| How many columns does a vector key need? | `resolve_profile` with kind `machine` | Read `printer_extruder_variant` — the machine preset is the authoritative column count |
| What does a `"nil"` column resolve to? | `resolve_profile` or `resolve_from_file` | Filled columns land in `nilResolved`, columns left literal in `nilUnresolved`; the `filament_*` family resolves only with `machineName` |
| Is my file free of dead pins and shape errors? | `lint_profile` | Checks `parent-equal-override`, `column-count`, `scalar-vector-mismatch`, `unknown-key`, `nil-equals-parent`; without `machineName` the column check lands in `skipped` |
| How do two arbitrary profiles differ? | `compare_profiles` | Each endpoint is `{preset}` or `{outputDir, name}`, mixed freely; `mode` `"resolved"` (default) or `"raw"` |
| Has my file drifted from its installed twin? | `diff_profile` | Adds both sides' `modifiedAt` and `newer`; reconciliation is the profile-drift skill |
| Create a file / edit one incrementally | `write_profile` (`kvps` is the complete override set) / `update_profile` (`set`, `remove`) | Both validate against the option schema and refuse unknown keys |
| Install / uninstall a preset | `import_profile` (`overwrite: true` to replace) / `remove_profile` | User store only; Bambu Studio sees the change after a restart |

## Recipe

1. **Choose the parent.** A vendor leaf scoped to the target printer exists → inherit it.
   Otherwise inherit the printer-scoped generic (`Generic <FAMILY> @BBL <model>`) and port
   the vendor's material deltas from its other-printer leaves — port only true deltas,
   which `compare_profiles` in `resolved` mode names directly. Never inherit a preset
   scoped to a different printer.
2. **Plan the delta set.** For each candidate key record: current effective value, new
   value, one-line rationale. Keep the set minimal; a key deliberately left inherited is a
   decision, not a delta. Sanity-check speed changes against the filament's volumetric
   ceiling: `max speed = filament_max_volumetric_speed / (layer_height × line_width)` —
   speeds above it never materialize.
3. **Write the file** into the project's profile directory. Metadata (`from`, `version`,
   settings ids) is synthesized at import time and never written by hand.
4. **Verify.** Run `lint_profile` with the workspace's `machineName` and resolve every
   finding. Then the two checks the server cannot make: `compatible_printers` names only
   the workspace's machine presets, and every override has a recorded rationale while
   every recorded rationale has its override — a mismatch in either direction is a defect,
   named per key.
5. **Install** with `import_profile`, confirm with `diff_profile` (expect
   `identical: true`), and remove superseded presets with `remove_profile`. Tell the user
   Bambu Studio needs a restart before the preset is visible.

## Red Flags

- Preset JSON written without `write_profile`/`update_profile` — hand-written files skip
  schema validation.
- A value quoted from memory instead of tool output.
- Speeds the volumetric ceiling makes impossible.
- Filament-side changes smuggled into a process preset.
