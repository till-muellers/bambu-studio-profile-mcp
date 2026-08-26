# `import_profile` never writes `version`, so Bambu Studio never loads the preset

**Severity:** critical — the primary install path has never worked for a new preset.
**Component:** `src/tools/import.ts`
**Found:** 2026-08-26, Bambu Studio 02.07.00.08, vendor bundle BBL 02.08.00.04, Windows.

## Summary

`import_profile` writes a preset JSON with no `version` key. Bambu Studio silently refuses to
load any user preset lacking one. The file lands on disk, `diff_profile` reports
`identical: true`, the tool reports success — and the preset does not exist as far as Studio
is concerned. Every failure mode of this bug is invisible.

## The defect

`src/tools/import.ts:81`:

```ts
const version = resolvedBase.settings.version;
const body: Record<string, unknown> = {
  name: args.name,
  inherits: source.inherits,
  from: "User",
  ...(typeof version === "string" ? { version } : {}),
  ...
};
```

`version` is sourced from the resolved parent chain's settings. **BBL system presets do not
carry a `version` key.** Verified against the live install:

| File | `version` |
|---|---|
| `system/BBL/process/0.10mm Standard @BBL P2S 0.2 nozzle.json` | absent |
| `system/BBL/process/fdm_process_common.json` | absent |

`resolver.ts` strips only `name` and `inherits`, so nothing is being filtered out — the key
was never there. `resolvedBase.settings.version` is therefore always `undefined`, the spread
always yields `{}`, and **no import has ever written a `version`.** This is not
edge-case-dependent.

## Why it is silent

`PresetCollection::load_presets` in `src/libslic3r/Preset.cpp` (BambuStudio):

```cpp
std::string version_str = key_values[BBL_JSON_KEY_VERSION];
boost::optional<Semver> version = Semver::parse(version_str);
if (!version) continue;
```

`key_values` is a `std::map`; `operator[]` on a missing key returns `""`. `Semver::parse("")`
fails, and the loop `continue`s. There is **no log line and no warning** on this branch — the
adjacent major-version-mismatch branch logs, this one does not. The preset simply is not
there.

## Compounding: the success note is actively misleading

```
"note": "Metadata keys in the source file were ignored and regenerated:
         from, version, print_settings_id. Bambu Studio picks this up after a restart."
```

`regenerated` is computed from which metadata keys were stripped off the **source**, not from
what was **written**. The tool states it regenerated a `version` it did not write. This is why
the bug survived: the tool affirmatively reports having done the thing it failed to do.

`STUDIO_RESTART_NOTE` compounds it by asserting a restart is sufficient. It is not, and that
claim was never verified.

## Reproduction

```
source: { name, inherits: "0.10mm Standard @BBL P2S 0.2 nozzle", from, print_settings_id,
          version: "2.7.0.8", brim_width: "7" }

import_profile -> note claims "regenerated: from, version, print_settings_id"

installed user/<id>/process/zzz-import-probe.json:
{
    "name": "zzz-import-probe",
    "inherits": "0.10mm Standard @BBL P2S 0.2 nozzle",
    "from": "User",
    "print_settings_id": "zzz-import-probe",
    "brim_width": "7"
}
```

No `version`. Source had one. Restart Studio: preset absent.

## Correct value and fix

Studio writes the **vendor bundle version**, normalized to Semver. `system/BBL.json` carries
`"version": "02.08.00.04"`; presets Studio saves after that bundle landed carry `"2.8.0.4"`,
and older ones `"2.7.0.8"`. Both forms are present in this user store, which confirms the
mapping is `02.08.00.04` -> `2.8.0.4` (strip leading zeros per component).

Fix: read `version` from the vendor index (`system/<vendor>.json`) and normalize, rather than
from the resolved parent settings. Fail the import loudly if it cannot be determined — a
preset without `version` is worthless, so writing one anyway is worse than erroring.

Two follow-ups in the same area:

1. Derive the `regenerated` note from the keys actually written, not the keys stripped from
   the source. A note that reports work not done is worse than no note.
2. Drop or qualify `STUDIO_RESTART_NOTE`. Beyond this bug, an installed preset is still
   invisible unless the active machine preset is listed in its `compatible_printers` — a
   nozzle-scoped preset does not appear while another nozzle's machine is selected.

## Suggested regression test

Import a preset whose parent chain has no `version`, then assert the installed JSON parses as
a Semver-bearing preset. The current test suite cannot be covering this path, since the
production behaviour is unconditional.
