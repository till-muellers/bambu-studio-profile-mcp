---
name: profile-drift
description: Use when Bambu Studio presets may have been hand-tuned in the slicer, when a print behaves like an older profile version, or when checking that project profile files still match what is installed — before trusting either side.
---

# Profile Drift Reconciliation

Project profile files and the installed user presets drift apart whenever someone tunes in
Bambu Studio or edits files without reinstalling. `diff_profile` is the instrument;
reconciliation goes in exactly one direction per key, chosen deliberately.

## Recipe

1. **Diff**: `diff_profile` with the preset name and the project's profile directory
   (`sourceName` when the file name differs). The result lists only real differences —
   `changed` (both values), `onlyInSource`, `onlyInstalled` — plus both files' mtimes and
   `newer`, which side changed last. `identical: true` ends the task.
2. **Interpret**:
   - `newer: "installed"` with changed keys → someone tuned in Studio. These are the
     hand-tuned values to harvest: apply them to the project file with `update_profile`
     (set the changed keys, remove keys only present installed-side if they belong), then
     record the rationale wherever the project documents deltas.
   - `newer: "source"` → the project file advanced without reinstalling. Install it:
     `import_profile` with `overwrite: true`, then `diff_profile` again — expect
     `identical: true`.
   - Mixed intent (some keys tuned in Studio, others edited in the file) → reconcile per
     key with the user before overwriting either side.
3. **Confirm**: after any reconciliation, `diff_profile` once more; `identical: true` is
   the exit criterion. Remind the user that Studio must restart to see installed changes.

## Diagnosing "the print used old values"

- A Bambu Studio instance started before an install keeps slicing from the old preset —
  instances share no preset state. Compare the Studio process start time (Windows:
  `Get-Process bambu-studio | Select-Object Id, StartTime`; elsewhere the OS process
  list) against the installed preset's `modifiedAt` from `diff_profile`. Restart Studio,
  then re-check.
- Machine-level values changed in Studio's Printer settings without saving a preset never
  appear in any file; `resolve_profile` cannot see them. Read them off the UI or have the
  user save a machine preset.

## Red Flags

- Overwriting the installed preset while `newer` says "installed" without harvesting
  first — that deletes the user's hand-tuning.
- Editing the project file to match a diff from memory instead of the `diff_profile`
  values.
- Assuming the repo copy matches after any Studio-side import or save.
