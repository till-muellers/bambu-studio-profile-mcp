# 0.5.0 Epic — Machine Kind, Nil Resolution, Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server answer the questions profile authoring actually asks — what columns a printer has, what a `"nil"` column really resolves to, which overrides are dead weight, and how two presets differ — without the agent falling back to file reads.

**Architecture:** Machine presets become a readable third `kind` (read-only; Studio owns writing them). The resolver gains element-wise nullable-vector merging so `"nil"` resolves to the value actually in effect, including the `filament_*` override family's deferral to the machine preset. Two new read tools sit on top: `lint_profile` (mechanical invariant checks) and `compare_profiles` (arbitrary two-endpoint comparison). The schema generator gains the machine option set, honest enum defaults, and unit strings.

**Tech Stack:** TypeScript (strict, ESM, Node 20+), MCP SDK `registerTool`, zod v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-bambu-studio-profile-mcp-design.md` (sections: Path configuration, Profile resolution, Tooling contracts). This plan extends it; Task 8 updates it.

## Global Constraints

- All user-facing strings live in `src/strings.ts`. Never inline a user-facing literal elsewhere in `src/`.
- Tool descriptions follow Purpose / Returns / Errors / cross-tool pointers; parameter detail only in zod `.describe`; no negations, no roadmap commentary.
- `src/types.ts` and `src/errors.ts` are locked contracts — extend additively only.
- `schema/*.schema.json` are generated. Never hand-edit. Descriptions come from `schema/descriptions.json` only, authored clean-room from key/label/type/range facts plus FDM domain knowledge. BambuStudio tooltip text must never enter an authoring prompt or the shipped files.
- Bambu Studio directories stay read-only for every tool except `import_profile`/`remove_profile`. **Machine kind is read-only everywhere — no write, import, or remove path may accept it.**
- Tool handlers are plain exported functions (`handleX(deps, args)`); registerTool callbacks stay thin.
- Every new tool gets a protocol-level test in `tests/server.test.ts` plus its entry in the sorted tool-name array (update the count wording in the test title).
- Tests never write into `tests/fixtures/` — writable stores are mkdtemp temp dirs.
- Commits: conventional style, multi-line messages via `git commit -F <file>`, each ending with a blank line then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verification gate per task: `npm run build` clean and `npm test` green. Report counts.
- Branch per task off `main`, PR per task, `ci` check green. Never merge without maintainer approval.
- BambuStudio checkout for generator work: `C:\Users\tillm\AppData\Local\Temp\claude\D--repos-printing-profile-mcp\8adffcba-d979-4b7e-8997-dcb934c7fc40\scratchpad\BambuStudio` (tag v02.07.00.55). Never clone into this repo.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/generate-schema/parse.ts` | C++ parsing: option blocks, option lists, override synthesis. Gains printer-option-list parsing, enum-default resolution, sidetext extraction. |
| `scripts/generate-schema/index.ts` | Pipeline + reporting. Gains machine schema emission and a completeness gate. |
| `schema/machine.schema.json` | Generated machine option schema (new). |
| `src/types.ts` | `ProfileKind` gains `"machine"`; `SchemaOption` gains `unit`. Additive only. |
| `src/profile-store.ts` | Machine directory reads for system and user stores. |
| `src/resolver.ts` | Element-wise nullable-vector merge; machine-deferral for `filament_*` overrides. |
| `src/tools/list.ts` | `source` filter on `list_profiles`; machine kind in `list_profiles`/`list_parameters`. |
| `src/tools/resolve.ts`, `src/tools/resolve-from-file.ts` | `keys` projection; machine kind. |
| `src/tools/lint.ts` | New: `lint_profile`. |
| `src/tools/compare.ts` | New: `compare_profiles`. |
| `plugin/skills/*/SKILL.md` | Decision matrix; skills shrink to judgement, not tool mechanics. |

Dependency order: **1 → 2 → 3 → {5, 6}**; **4** is independent; **7** and **8** last.

---

### Task 1: Generator — machine option set, honest enum defaults, units

**Files:**
- Modify: `scripts/generate-schema/parse.ts`, `scripts/generate-schema/index.ts`
- Generate: `schema/machine.schema.json`, regenerate `schema/{process,filament}.schema.json`
- Modify: `schema/descriptions.json` (machine keys — original text only)
- Test: `tests/generate-schema.test.ts`, fixture `tests/fixtures/cpp/print-config-snippet.cpp`, `tests/fixtures/cpp/preset-snippet.cpp`

**Interfaces:**
- Produces: `parsePrinterOptionList(cppSource: string): string[]`, `resolveEnumDefault(rawDefault: string, enumValues: string[]): string | undefined`, and `SchemaOption.unit?: string`.

Three separable defects, one commit each.

**(a) Machine option list.** `Preset::printer_options()` is not a simple `return <var>;` — it composes `s_Preset_printer_options`, `s_Preset_machine_limits_options`, and `Preset::nozzle_options()`, the last of which is `print_config_def.extruder_option_keys()` and computed at runtime, so it cannot be parsed statically.

- [ ] **Step 1:** Write a failing test for `parsePrinterOptionList` against a fixture containing both static vectors; assert keys from both appear and commented-out keys do not. Reuse `parseStringVector`'s comment-stripping.
- [ ] **Step 2:** Run it; expect failure (function not exported).
- [ ] **Step 3:** Implement `parsePrinterOptionList` as the union of `s_Preset_printer_options` and `s_Preset_machine_limits_options` via the existing `parseStringVector`.
- [ ] **Step 4:** In `index.ts`, emit `schema/machine.schema.json` from that key set, and add a **completeness gate**: read every `*.json` under `<checkout>/resources/profiles/BBL/machine/`, collect their keys, subtract identity/metadata keys (`name`, `from`, `version`, `inherits`, `instantiation`, `setting_id`, `printer_settings_id`, `type`, `printer_model`, `printer_variant`), and `process.exit(1)` listing any key missing from the emitted schema. This is what catches the unparseable `nozzle_options()` contribution.
- [ ] **Step 5:** Run the generator against the checkout. Add the reported missing keys by extending the parsed set with the extruder-scoped option keys the gate names — every added key must be a real `this->add("<key>", co...)` block in PrintConfig.cpp; never invent one. Re-run until the gate passes.
- [ ] **Step 6:** Author original descriptions in `schema/descriptions.json` for every machine key the overlay reports missing. Clean-room rule applies. Regenerate; all three schemas report 0 missing.
- [ ] **Step 7:** Commit `feat: generate the machine option schema`.

**(b) Enum defaults.** `coEnums` options whose C++ default is an enum constant currently ship the identifier verbatim (`"(int)Overhang_threshold_bridge"`, `"ZHopType::zhtSpiral"`, and the bare `0` on `filament_scarf_seam_type`).

- [ ] **Step 1:** Write failing tests: a fixture enum option defaulting to `ZHopType::zhtSpiral` yields `"Spiral Lift"`; one defaulting to `(int)Overhang_threshold_bridge` with no resolvable mapping yields **no `default` key at all**; a numeric default indexes `enum` (`0` → first token).
- [ ] **Step 2:** Run; expect failure.
- [ ] **Step 3:** Implement `resolveEnumDefault`: strip `(int)` casts and whitespace; a plain integer indexes `enumValues`; a `Scope::identifier` form resolves by matching the identifier's trailing CamelCase segment against enum tokens case-insensitively with separators stripped (`zhtSpiral` → `Spiral Lift`); anything unresolved returns `undefined` and the caller omits `default`. **An omitted default is correct; a fabricated one is a defect.**
- [ ] **Step 4:** Run tests; green. Regenerate; grep the shipped schemas for `::`, `(int)`, and `L(` — zero hits required.
- [ ] **Step 5:** Commit `fix: resolve or omit enum defaults instead of shipping C++ identifiers`.

**(c) Units.** `def->sidetext = L("mm")` carries the unit string, currently dropped.

- [ ] **Step 1:** Write a failing test: an option with `def->sidetext = L("mm/s")` yields `unit: "mm/s"`; an option without sidetext has no `unit` key.
- [ ] **Step 2:** Run; expect failure.
- [ ] **Step 3:** Add `unit?: string` to `SchemaOption` in `src/types.ts` (additive). Extract sidetext with the same literal-concatenation handling `extractLField` uses.
- [ ] **Step 4:** Regenerate; verify `layer_height.unit === "mm"`. `npm test` green.
- [ ] **Step 5:** Commit `feat: carry option units from sidetext into the schema`.

---

### Task 2: Machine kind in the stores and read tools

**Files:**
- Modify: `src/types.ts` (`ProfileKind`), `src/profile-store.ts`, `src/tools/list.ts`, `src/tools/resolve.ts`, `src/tools/resolve-from-file.ts`, `src/strings.ts`
- Test: `tests/profile-store.test.ts`, `tests/tools-list.test.ts`, `tests/tools-resolve.test.ts`, `tests/server.test.ts`; fixture machine presets under `tests/fixtures/install/.../machine/`

**Interfaces:**
- Consumes: `schema/machine.schema.json` (Task 1).
- Produces: `ProfileKind = "process" | "filament" | "machine"` and machine-capable `handleResolve`, `handleResolveFromFile`, `handleList*`.

- [ ] **Step 1:** Add two fixture machine presets to `tests/fixtures/install/.../machine/` — a parent and a child with `inherits`, one carrying `printer_extruder_variant` as a three-element array. Fixtures are read-only to tests.
- [ ] **Step 2:** Write failing tests: `handleResolve(deps, "machine", {vendor: "BBL", name: "<child>"})` returns merged settings including `printer_extruder_variant`; `handleList` with kind `machine` lists both; `list_parameters` kind `machine` returns machine schema keys.
- [ ] **Step 3:** Run; expect failures (kind rejected).
- [ ] **Step 4:** Widen `ProfileKind` and thread `"machine"` through the store's directory resolution and the three read tools' zod enums and `.describe` texts. **Leave `write_profile`, `update_profile`, `import_profile`, `remove_profile`, and `diff_profile` at `process | filament`** — machine presets are Studio-owned. Their `.describe` texts stay unchanged.
- [ ] **Step 5:** Add a test asserting `handleWrite`/`handleImport`/`handleRemove` reject `"machine"` (type-level plus a runtime guard test through the protocol).
- [ ] **Step 6:** `npm test` green. Update the README tool table's kind wording where it says process/filament for the read tools.
- [ ] **Step 7:** Commit `feat: read machine presets via resolve, list, and list_parameters`.

---

### Task 3: Element-wise nil resolution

**Files:**
- Modify: `src/resolver.ts`, `src/types.ts` (additive result field), `src/strings.ts`
- Test: `tests/resolver.test.ts`, `tests/tools-resolve.test.ts`

**Interfaces:**
- Consumes: machine kind (Task 2) for the `filament_*` deferral.
- Produces: resolved settings with `"nil"` elements replaced, plus `nilResolved: Record<string, number[]>` on the result naming, per key, the column indices whose value came from the parent rather than the profile.

Semantics, source-verified: a `"nil"` element means "keep the value the parent supplies for this column". For the `filament_*` override family (the keys synthesized in 0.2.0 from `filament_extruder_override_keys` / `filament_overhang_override_keys`), the parent is not the filament chain — it is the machine preset's same-named key with the `filament_` prefix stripped.

- [ ] **Step 1:** Write failing tests in `tests/resolver.test.ts`: (a) a child with `["22","22","nil"]` over a parent with `["12","12","12"]` resolves to `["22","22","12"]` and reports `nilResolved: { <key>: [2] }`; (b) a full-`nil` array resolves entirely to the parent's values; (c) a `nil` in a `filament_retraction_length` array resolves from the machine preset's `retraction_length` at the same index, given a machine preset in the fixture store; (d) a `nil` with no parent value at that index stays `"nil"` and is reported.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement element-wise merge in the resolver: when both child and parent values are arrays and the child element is exactly `"nil"`, take the parent's element at that index. Non-array values and non-`"nil"` elements keep current behavior. Resolve the `filament_*` deferral by consulting the machine preset named by the resolution request; when no machine preset is available, leave those `"nil"` elements intact and report them — never guess.
- [ ] **Step 4:** Run; green.
- [ ] **Step 5:** Add a test proving `diff_profile` and `import_profile` are unaffected — they compare and install file bytes, not resolved values. Assert a file with `"nil"` round-trips through import unchanged.
- [ ] **Step 6:** `npm test` green. Commit `feat: resolve nil vector columns to their inherited values`.

---

### Task 4: Key projection and source filter (independent of Tasks 1-3)

**Files:**
- Modify: `src/tools/resolve.ts`, `src/tools/resolve-from-file.ts`, `src/tools/list.ts`, `src/strings.ts`
- Test: `tests/tools-resolve.test.ts`, `tests/tools-resolve-from-file.test.ts`, `tests/tools-list.test.ts`

- [ ] **Step 1:** Write failing tests: `handleResolve` with `keys: ["layer_height", "wall_loops"]` returns exactly those keys in `settings` (chain unchanged); an unknown key in `keys` is reported in a `missingKeys` array rather than throwing; `handleList` for profiles with `source: "user"` returns only user rows, `source: "system"` only system rows, omitted returns both.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Add optional `keys?: string[]` to both resolve tools (filter after resolution, so inheritance is unaffected) and optional `source?: "user" | "system"` to `list_profiles`. Add `.describe` texts and extend the tool descriptions' Returns sections in `src/strings.ts`.
- [ ] **Step 4:** Run; green. `npm test`. Commit `feat: key projection on resolve tools and source filter on list_profiles`.

---

### Task 5: `lint_profile`

**Files:**
- Create: `src/tools/lint.ts`
- Modify: `src/index.ts`, `src/strings.ts`, `README.md`
- Test: `tests/tools-lint.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: machine kind (Task 2), nil resolution (Task 3), `SchemaOption.vector` (Task 1).
- Produces: `handleLint(deps, kind, args)`.

Inputs mirror `resolve_from_file`: `kind` (`process | filament`), `vendor`, `outputDir`, `name`, optional `sourceName`, optional `machineName` (the machine preset whose `printer_extruder_variant` defines the expected column count; when omitted, column checks that need it are reported as `skipped` with the reason).

Findings, each `{ check, key, detail }`, grouped by severity:
1. `parent-equal-override` — the file's value deep-equals the chain's resolved value for that key. Dead weight.
2. `column-count` — a vector key's array length differs from the machine's variant count.
3. `scalar-vector-mismatch` — the file gives an array where the schema says scalar, or vice versa.
4. `unknown-key` — not in the kind's schema (reuse the existing validator).
5. `nil-equals-parent` — a `"nil"` column whose resolved value equals the file's stated value elsewhere; harmless but noise.

Result: `{ kind, name, path, clean: boolean, findings: [...], skipped: [{check, reason}] }`.

- [ ] **Step 1:** Write failing tests, one per check plus a clean-file case asserting `clean: true` and empty `findings`; and a case with no `machineName` asserting `column-count` lands in `skipped`, not `findings`.
- [ ] **Step 2:** Run; expect failure (module absent).
- [ ] **Step 3:** Implement `handleLint` reusing `resolveProfile` for the parent chain, `loadSchema`/`validateKvps` for unknown keys, and the same metadata skip-set as `diff`/`import` (`SYNTHESIZED_METADATA_KEYS` plus `name`, plus `inherits` — a lint of overrides does not lint the base).
- [ ] **Step 4:** Register in `src/index.ts`; add strings entry in house style, pointing to `write_profile`/`update_profile` for fixes and `import_profile` for installing. Annotations: `readOnlyHint: true`.
- [ ] **Step 5:** Add the protocol test and the sorted-array entry; update the count wording. Add the README tool-table row.
- [ ] **Step 6:** `npm test` green. Commit `feat: lint_profile reports parent-equal overrides and shape mismatches`.

---

### Task 6: `compare_profiles`

**Files:**
- Create: `src/tools/compare.ts`
- Modify: `src/index.ts`, `src/strings.ts`, `README.md`
- Test: `tests/tools-compare.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: resolution incl. machine kind and nil handling (Tasks 2, 3).
- Produces: `handleCompare(deps, args)`.

Inputs: `kind`, `vendor`, `left`, `right`, and `mode: "raw" | "resolved"` (default `"resolved"`). Each endpoint is `{ preset: string }` (installed or system, by name) **or** `{ outputDir: string, name: string }` (a file). `raw` compares the endpoints' own keys; `resolved` compares their fully resolved settings. This answers both "how do these two entries shape their arrays" and "what do these two system bases actually differ on".

Result reuses the diff vocabulary so agents learn one shape: `{ mode, left: {label, path?}, right: {label, path?}, identical, changed: [{key, left, right}], onlyLeft: [{key, value}], onlyRight: [{key, value}] }`.

- [ ] **Step 1:** Write failing tests: two installed presets in `resolved` mode report only genuine differences; the same pair in `raw` mode reports their declared keys; a file-vs-preset pair works in both directions; identical endpoints report `identical: true`; a nonexistent endpoint errors naming which side.
- [ ] **Step 2:** Run; expect failure.
- [ ] **Step 3:** Implement, reusing `diff.ts`'s `deepEqual` — extract it to a shared module rather than copying (`src/compare-values.ts`), and update `diff.ts` to import it. No behavior change to `diff_profile`; its tests must stay green untouched.
- [ ] **Step 4:** Register; strings entry in house style with a pointer distinguishing it from `diff_profile` (drift between a file and its installed twin) — `compare_profiles` answers arbitrary pairs.
- [ ] **Step 5:** Protocol test, sorted-array entry, count wording, README row.
- [ ] **Step 6:** `npm test` green. Commit `feat: compare_profiles for arbitrary preset pairs`.

---

### Task 7: Release 0.5.0

- [ ] **Step 1:** Confirm `main` carries Tasks 1-6. `npm run build && npm test` green; report counts.
- [ ] **Step 2:** Branch `release/v0.5.0`; `npm version minor --no-git-tag-version`; commit `chore: release 0.5.0`; PR; merge on green.
- [ ] **Step 3:** Verify the tip reads `0.5.0`, then tag `v0.5.0` and push the tag. Confirm npm `latest`, the GitHub Release, and the Packages mirror.

---

### Task 8: Plugin update — decision matrix

**Files:**
- Modify: `plugin/skills/profile-authoring/SKILL.md`, `plugin/skills/profile-drift/SKILL.md`, `plugin/skills/profile-workspace-init/SKILL.md`, `plugin/README.md`, `plugin/.claude-plugin/plugin.json` (version bump)
- Modify: `docs/superpowers/specs/2026-08-22-bambu-studio-profile-mcp-design.md` (current behavior only)

The matrix is the shortening device: each skill's prose about *which tool to call* collapses into rows, leaving the skill to carry judgement — what makes a good delta, when to harvest versus overwrite, what to elicit.

- [ ] **Step 1:** Add a `## Tool Decision Matrix` section to `profile-authoring/SKILL.md` with columns **Question → Tool → Note**, covering at least: what does key X accept (`list_parameters`) · what value is in effect for an installed preset (`resolve_profile`) · …for a file not yet installed (`resolve_from_file`) · how many columns does a vector key need (`resolve_profile` kind `machine`, read `printer_extruder_variant`) · what does a `"nil"` column resolve to (either resolve tool; read `nilResolved`) · is my file free of dead pins and shape errors (`lint_profile`) · how do two presets differ (`compare_profiles`) · has my file drifted from the installed preset (`diff_profile`) · what exists (`list_profiles`, `source` filter) · write/edit/install/remove (`write_profile`/`update_profile`/`import_profile`/`remove_profile`).
- [ ] **Step 2:** Delete the prose each row replaces. The verification step becomes "run `lint_profile`; resolve any finding" plus the project-specific checks the server cannot do (rationale ↔ override cross-check). Net line count must go **down**; report before/after.
- [ ] **Step 3:** In `profile-workspace-init/SKILL.md`, replace the process-preset probe for column count with the authoritative machine-preset probe (`resolve_profile` kind `machine` → `printer_extruder_variant`), and record the machine preset name in the workspace section so later `lint_profile` calls can pass `machineName`.
- [ ] **Step 4:** In `profile-drift/SKILL.md`, point the "compare two arbitrary things" case at `compare_profiles` and keep the harvest decision tree intact.
- [ ] **Step 5:** Bump the plugin version; update `plugin/README.md`'s skill blurbs. Commit `docs: decision matrix and machine-aware skill guidance`.

---

## Self-Review

**Spec coverage:** All six review gaps map to tasks — machine invisibility (2), nil resolution (3), no profile-to-profile compare (6), no invariant validation (5), no key projection (4), no source filter (4). Both defects map: enum defaults (1b), and the units gap surfaced during review (1c). Plugin follow-through is Task 8.

**Placeholder scan:** No TBDs. Every check, field name, and error condition is named. Task 1(a)'s unknown — which extruder-scoped keys `nozzle_options()` contributes — is resolved by a mechanical gate that names them, not by guesswork.

**Type consistency:** `ProfileKind` widens once (Task 2) and is consumed by 3, 5, 6. `nilResolved` is produced in Task 3 and consumed by the matrix row in Task 8. `deepEqual` moves to `src/compare-values.ts` in Task 6 and `diff.ts` follows it there. `SchemaOption.unit` is produced in 1(c) and surfaced by `list_parameters` without further change.
