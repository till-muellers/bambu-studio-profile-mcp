---
name: profile-authoring
description: Use when creating or editing a Bambu Studio process or filament preset — a new material entry, a tuning variant, or any parameter change destined for the slicer — before writing any preset JSON by hand.
---

# Profile Authoring

Author presets as schema-validated minimal-delta files through the bambu-profiles MCP,
then install them. Requires the project's `## Printing Workspace` section (run
profile-workspace-init first when it is missing); `init_config` once per session.

## Recipe

1. **Choose the parent** with `list_profiles` (search the material family or vendor):
   - A vendor leaf scoped to the target printer exists → inherit it.
   - Otherwise inherit the printer-scoped generic (`Generic <FAMILY> @BBL <model>`) and
     port the vendor's material deltas from its other-printer leaves. Port only true
     deltas: `resolve_profile` both sides and override a key only where the effective
     values differ.
   - Never inherit a preset scoped to a different printer.
2. **Plan the delta set.** For each candidate key record: current effective value
   (`resolve_profile` — never assume), new value, one-line rationale. Keep the set
   minimal; a key deliberately left inherited is a decision, not a delta.
3. **Validate every value** with `list_parameters`: type, range, enum tokens, `vector`
   flag, `nullable` (`"nil"` support). Vector keys carry the workspace's column count;
   use `"nil"` for columns that should keep the inherited value. Sanity-check speed
   changes against the filament's volumetric ceiling:
   `max speed = filament_max_volumetric_speed / (layer_height × line_width)` with the
   ceiling from `resolve_profile` on the filament preset — speeds above it never
   materialize.
4. **Write the file**: `write_profile` (new) or `update_profile` (incremental set/remove)
   into the project's profile directory. These tools validate against the option schema
   and refuse unknown keys; metadata (`from`, `version`, settings ids) is synthesized at
   import time and never written by hand.
5. **Verify mechanically** before considering the work done — these rules hold only when
   checked:
   - `resolve_profile` on the result: the chain contains only presets scoped to the
     target printer (or `fdm_*`/`@base` roots), and no override equals its resolved
     parent value.
   - Each vector key's column count matches the workspace section; `compatible_printers`
     names only the workspace's machine presets.
   - Every override has a recorded rationale, and every recorded rationale has its
     override — a mismatch in either direction is a defect, named per key.
6. **Install**: `import_profile` from the profile directory (`overwrite: true` when
   replacing a prior version). Confirm with `diff_profile` — expect `identical: true`.
   Remove superseded presets with `remove_profile`. Tell the user Bambu Studio needs a
   restart before the preset is visible.

## Red Flags

- Preset JSON written without `write_profile`/`update_profile` — hand-written files skip
  schema validation.
- A value quoted from memory instead of `resolve_profile`/`list_parameters` output.
- Speeds the volumetric ceiling makes impossible.
- Filament-side changes smuggled into a process preset.
