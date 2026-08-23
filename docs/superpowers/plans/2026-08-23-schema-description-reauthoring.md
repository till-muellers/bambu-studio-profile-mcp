# Schema Description Reauthoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 2 is an ORCHESTRATOR task: the controller fans out research/authoring agents itself instead of dispatching a single implementer.

**Goal:** Distributed schemas carry only original, agent-optimized description texts from a checked-in overlay; no BambuStudio tooltip text ships.

**Architecture:** Three stages, matching the multi-agent baseline: (1) code — the generator stops emitting tooltip text and merges `schema/descriptions.json` with a coverage report; (2) research/authoring — high-capability agents author original telegraph-style descriptions per key batch, researching facts (not wording) where needed; (3) transcription — batch outputs merge into the overlay, schemas regenerate, coverage reaches 100%.

**Tech Stack:** TypeScript strict ESM, Vitest, tsx (generator); orchestrated authoring agents (highest available model) with web research.

**Spec:** `docs/superpowers/specs/2026-08-23-schema-description-reauthoring-design.md`

## Global Constraints

- Clean-room rule (binding, from the spec): authoring inputs are the option key, `label`, `type`, `vector`, `enum`, `min`, `max`, `default`, `nullable`, and general FDM domain knowledge. Web research (Bambu wiki, community docs) may be used to learn FACTS about a setting; quoting or paraphrasing researched sentences is forbidden — descriptions are composed originally in the style contract's telegraph form. BambuStudio tooltip texts are never placed in an authoring prompt.
- Style contract (from the spec): telegraph style, target ≤ 240 characters; order: what the lever controls → effect of raising/lowering → notable interactions → typical values/rule of thumb; enum options get one clause per non-obvious value; no marketing tone, no second person.
- Schema entry shape unchanged (`description?: string`); `list_parameters`, validator, and all runtime code untouched.
- Overlay file: `schema/descriptions.json`, option key → description string, one entry per key shared across both kinds.
- This plan runs concurrently with the string-resources plan, which touches ONLY `src/**` (excluding nothing this plan needs) and `tests/strings.test.ts`. This plan touches ONLY `scripts/generate-schema/**`, `schema/**`, `tests/generate-schema.test.ts`, `tests/fixtures/cpp/**`, `tests/fixtures/schema/**` (only if needed), and `docs/`.
- Test commands: `npx vitest run <file>` / `npm test`. Commit after every task with the given message.
- BambuStudio checkout for regeneration: reuse `C:\Users\user\AppData\Local\Temp\claude\D--repos-bambu-studio-profile-mcp\00000000-0000-0000-0000-000000000000\scratchpad\BambuStudio` (tag v02.07.00.55); if absent, shallow-clone that tag into the scratchpad — never into the repo.

---

### Task 1: Generator overlay support

**Files:**
- Modify: `scripts/generate-schema/parse.ts`, `scripts/generate-schema/index.ts`
- Create: `schema/descriptions.json` (initial content: `{}`)
- Test: `tests/generate-schema.test.ts` (extend), `tests/fixtures/cpp/print-config-snippet.cpp` (only if a tooltip-bearing block is needed and missing — the fixture already contains tooltip lines)

**Interfaces:**
- Consumes: existing `parsePrintConfig(cppSource)` / `parseOptionList(...)` and the CLI flow in `index.ts`.
- Produces:
  - `parsePrintConfig` no longer sets `description` on returned options (label extraction and all facts unchanged).
  - New exported function in `index.ts`-adjacent module scope or `parse.ts`: `applyDescriptions(options: Record<string, SchemaOption>, overlay: Record<string, string>): { applied: number; missing: string[]; stale: string[] }` — sets `description` from the overlay per key; `missing` = option keys without overlay entry; `stale` = overlay keys matching no option.
  - CLI behavior: loads `schema/descriptions.json` relative to the repo (error with the path if absent/unparseable); after writing schema files prints to stderr per kind: applied/missing counts and the full missing-key list; stale keys printed once as a warning list.

- [ ] **Step 1: Write the failing tests (extend `tests/generate-schema.test.ts`)**

```typescript
import { applyDescriptions } from "../scripts/generate-schema/parse.js";

describe("description overlay", () => {
  it("parsePrintConfig emits no tooltip-derived descriptions", async () => {
    const source = await readFile(FIXTURE, "utf8");
    const options = parsePrintConfig(source);
    for (const option of Object.values(options)) {
      expect(option.description).toBeUndefined();
    }
    // labels still extracted
    expect(options.layer_height.label).toBe("Layer height");
  });

  it("applyDescriptions sets overlay text and reports coverage", () => {
    const options = {
      layer_height: { type: "float", vector: false } as SchemaOption,
      wall_loops: { type: "int", vector: false } as SchemaOption,
    };
    const result = applyDescriptions(options, {
      layer_height: "Z height per layer.",
      ghost_key: "no such option",
    });
    expect(options.layer_height.description).toBe("Z height per layer.");
    expect(options.wall_loops.description).toBeUndefined();
    expect(result.applied).toBe(1);
    expect(result.missing).toEqual(["wall_loops"]);
    expect(result.stale).toEqual(["ghost_key"]);
  });
});
```

(Adjust imports to the file's existing style; `SchemaOption` comes from `src/types.ts` as elsewhere in this test file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generate-schema.test.ts`
Expected: FAIL — descriptions still emitted by `parsePrintConfig`; `applyDescriptions` not exported.

- [ ] **Step 3: Implement**

In `parse.ts`: delete the tooltip→description assignment (keep the `extractLField`/decode machinery ONLY if labels still need it — labels do; remove tooltip-specific extraction if nothing consumes it). Add `applyDescriptions` exactly per Produces. In `index.ts`: load `schema/descriptions.json` (resolve relative to the script's repo, consistent with how `schema/` output paths are built), call `applyDescriptions` per kind after `pick(...)`, print the coverage/stale report to stderr. Create `schema/descriptions.json` containing `{}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generate-schema.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Full suite**

Run: `npm run build && npm test`
Expected: everything green (runtime code untouched; fixture schema files untouched, so list/validator tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-schema/ schema/descriptions.json tests/generate-schema.test.ts
git commit -m "feat: description overlay in schema generator with coverage report"
```

---

### Task 2: Research and author descriptions (ORCHESTRATOR TASK)

No repository code changes. The controller executes this task itself; its deliverable is a set of reviewed batch fragment files in the session scratchpad.

**Interfaces:**
- Consumes: the current schema files (facts per key) — descriptions in them are IGNORED as authoring input (clean-room rule).
- Produces: `scratchpad/descriptions-batches/batch-<NN>.json` fragment files, each `{ "<key>": "<description>", ... }`, together covering every key of both schemas, each batch reviewed.

- [ ] **Step 1: Build the key inventory and batches**

From the repo root, extract per-key facts WITHOUT descriptions into batch inputs of at most 40 keys (PowerShell or a tsx one-liner; either is fine). Inventory entry shape per key: `{ key, kinds: ["process"|"filament", ...], label?, type, vector, enum?, min?, max?, default?, nullable? }` — `kinds` records which schema(s) the key appears in. Write `scratchpad/descriptions-batches/input-<NN>.json` files and record the total key and batch counts.

- [ ] **Step 2: Dispatch one authoring agent per batch (parallel)**

Model: the most capable available (user directive: high-value model). One agent per `input-<NN>.json`, each instructed with, verbatim in every dispatch:
- The style contract and clean-room rule from Global Constraints (copied in full).
- Web research is allowed and encouraged where the agent's own FDM knowledge is thin: consult the Bambu Lab wiki or community sources to learn what a setting does and its typical values — then close the sources and write original telegraph text. Never quote, never mirror sentence structure, never translate a source sentence.
- Output: write `scratchpad/descriptions-batches/batch-<NN>.json` mapping every input key to its description; reply with key count and any keys they could not author confidently (those are listed, not guessed).
- Descriptions for enum-typed keys must cover non-obvious enum values; vector-typed keys should mention the per-variant dimension only when it changes how the value is chosen.

- [ ] **Step 3: Review each batch (parallel, as batches land)**

One reviewer agent per batch (mid-tier model), given the batch input facts + output fragment, checking: every key covered; style contract held (length, order, telegraph form, no second person); content plausible for the named setting (flag anything that misdescribes a lever); no text that reads like documentation boilerplate (paraphrase smell). Findings go back to the batch's author agent for one fix round; the controller adjudicates residuals.

- [ ] **Step 4: Record completion**

All batches present and reviewed → note total keys covered and any keys authored with low confidence (carried into Task 3's report). No commit (nothing in the repo changed).

---

### Task 3: Transcribe, regenerate, verify

**Files:**
- Modify: `schema/descriptions.json` (merge of all batch fragments), `schema/process.schema.json`, `schema/filament.schema.json` (regenerated)

**Interfaces:**
- Consumes: batch fragments from Task 2; the generator from Task 1; the BambuStudio checkout (Global Constraints).
- Produces: fully covered overlay + regenerated schemas containing only overlay descriptions.

- [ ] **Step 1: Merge fragments into the overlay**

Merge all `batch-<NN>.json` files into `schema/descriptions.json`, keys sorted alphabetically. Duplicate keys across fragments with DIFFERENT texts are an error to resolve (pick none silently — escalate to the controller). A tsx or PowerShell merge one-liner is fine; show the resulting key count.

- [ ] **Step 2: Regenerate the schemas**

Run: `npx tsx scripts/generate-schema/index.ts <checkout-path>`
Expected: both schema files written; stderr coverage report shows **0 missing keys** per kind and no stale keys (stale keys at this step mean a batch authored a key the generator no longer emits — investigate before proceeding). Key counts remain 265 process / 114 filament.

- [ ] **Step 3: Verify no source text shipped**

Spot-verify (PowerShell): pick 5 keys whose OLD descriptions are known from git (`git show HEAD:schema/process.schema.json`), confirm the new texts differ entirely, and search the new files for three distinctive phrases from old tooltip texts (e.g. from `git show`) — zero matches expected. Also verify `layer_height` and `outer_wall_speed` carry overlay text and `type`/`vector`/`enum`/`min`/`max`/`nullable` fields are unchanged versus the previous generation (facts must not drift).

- [ ] **Step 4: Full suite**

Run: `npm run build && npm test`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add schema/
git commit -m "feat: original agent-oriented schema descriptions replace tooltip text"
```

- [ ] **Step 6: Report**

Report to the user: total keys authored, batch count, low-confidence keys (if any), coverage 0-missing confirmation, and the licensing consequence (distributed schemas now carry no BambuStudio text; regeneration after future Bambu updates lists new keys needing authorship).

---

## Self-Review Notes

- Spec coverage: overlay file + merge + coverage report (Task 1), style contract + clean-room authoring incl. the user's wiki-research baseline (Task 2), migration/regeneration/verification incl. tooltip-remnant search and 100% coverage (Task 3), stale-key warning (Tasks 1 & 3), out-of-scope items untouched (labels, runtime, localization).
- Task 2 is deliberately an orchestrator task: subagent-driven-development's one-implementer-per-task shape does not fit a parallel authoring fan-out; the controller owns dispatch and review there, matching the user's three-stage baseline (refactor ∥ research → transcription).
- Fixture schemas are NOT regenerated (they are hand-made test data with our own texts) — list_parameters tests therefore stay green with no changes, satisfying the spec's constraint.
