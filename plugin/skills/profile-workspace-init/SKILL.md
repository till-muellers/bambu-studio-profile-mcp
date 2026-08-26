---
name: profile-workspace-init
description: Use when a project starts working with Bambu Studio printing profiles and has no recorded printer context yet — before the first resolve, write, or import — or when the printer, nozzle set, or Bambu Studio version changed.
---

# Profile Workspace Init

Establish the per-project facts every later profile task depends on, and record them so no
session has to rediscover them. The output is a `## Printing Workspace` section in the
project's `CLAUDE.md` (create the file if absent).

## Recipe

1. **Configure the server**: call `init_config` with no arguments. Every value
   auto-detects from the local Bambu Studio installation; the result persists in
   `.bambu-studio-profile-mcp/` (add that directory to the project's `.gitignore` — it is
   machine-local). If detection fails, ask the user for the install directory, user data
   directory, or account id (`default` when not logged in) and pass them explicitly.
2. **Elicit the target printer** from the user: exact model (e.g. "P2S", "X1C", "A1"),
   nozzle sizes in use, AMS units if any. The printer scopes every later decision; never
   guess it from the installed presets, since one installation serves many printers.
3. **Probe the stores** (`list_profiles` takes the printer model as `search`):
   - kind `machine`: pick the preset matching the model and nozzle the user named, then
     `resolve_profile` kind `machine` on it and read `printer_extruder_variant`. Its length
     and labels are the extruder-variant column shape every vector key on this printer uses
     (e.g. three columns "Direct Drive Standard / High Flow / E3D High Flow").
   - kind `process`: the system preset names available for this printer — the inheritance
     parents. `list_vendors` for the vendor ids in this installation.
4. **Write the workspace section** to the project's `CLAUDE.md`:

   ```markdown
   ## Printing Workspace

   - Printer: <model>, nozzles <sizes>, AMS <units or none>.
   - Machine preset: <exact name> — the `machineName` argument of `lint_profile`,
     `resolve_profile`, `resolve_from_file`, and `compare_profiles`, and the name
     `compatible_printers` lists.
   - Inherit only system presets scoped to this printer (for Bambu-brand machines the
     `@BBL <model>` suffix; other vendors per the scoping observed in `list_profiles`) or
     `fdm_*`/`@base` roots; other printers' presets carry wrong bed/chamber values.
   - Extruder-variant columns: <N> (<labels>). Vector keys carry <N> columns; a "nil"
     element keeps the inherited value for that column.
   - Call `init_config` (no arguments) before the first profile tool call of a session.
   - Bambu Studio sees installs and removals only after a restart; an instance running
     during the change keeps slicing from the old state.
   - After editing profile files: `import_profile`. After tuning in Studio:
     `diff_profile` and harvest. Never let the two drift silently.
   ```

   Fill every placeholder with the probed value; drop nothing. Update stale facts in place,
   and where the project's `CLAUDE.md` already records them in its own wording, update them
   there rather than adding a duplicate section — one home per fact.
5. **Report** the recorded facts to the user and name the file updated.

## Gotchas worth recording when they apply

- Machine-level values changed in Studio's Printer settings without saving a preset are
  invisible to `resolve_profile`. Read such keys off the Studio UI or have the user save a
  machine preset first.
- Vendor-shipped presets sometimes inherit another brand's system presets and carry that
  brand's vendor, density, and cost data. Treat them as a reference to harvest deltas from,
  not as an inheritance base, unless verified with `compare_profiles`.
