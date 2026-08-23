# printing-profile-mcp — Schema Description Reauthoring

## Purpose

The distributed schema files (`schema/process.schema.json`,
`schema/filament.schema.json`) carry only description texts authored for
this project. No text copied from the BambuStudio source ships in any
distributed file. The descriptions are written for agent consumption:
dense, abbreviated knowledge about what each setting does to a print —
not polished prose.

## Description overlay

`schema/descriptions.json` (checked in, original authorship, reviewed)
maps option key → description string:

```json
{
  "layer_height": "Z height per layer. ↓finer detail, better overhangs, longer print; ↑faster, weaker layer bond visibility. Typical 0.08-0.28 for 0.4 nozzle; ≤80% of nozzle diameter.",
  "outer_wall_speed": "Print speed of outermost perimeter. ↓better surface finish, dimensional accuracy; ↑faster, more ringing/artifacts. Usually slowest wall speed."
}
```

One entry per option key; both schemas draw from the same overlay (keys
appearing in both process and filament option lists get one shared
entry).

### Authoring style contract

- Telegraph style; sentence fragments allowed; target ≤ 240 characters.
- Content order: what the lever controls → effect of raising/lowering
  (quality, speed, strength, adhesion, material use) → notable
  interactions with other settings → typical values or a rule of thumb
  when one exists.
- Enum options: one clause per value when the value names are not
  self-explanatory.
- No marketing tone, no second person, no filler.

### Clean-room rule (binding)

Descriptions are authored from: the option key, its extracted `label`,
`type`, `vector`, `enum`, `min`, `max`, `default`, and general FDM
3D-printing domain knowledge. BambuStudio's tooltip texts are not an
input to authoring — not as source, not as paraphrase base. Authoring
prompts must not contain them.

## Generator changes (`scripts/generate-schema/`)

- `parse.ts` keeps extracting `label` (short functional names) and all
  facts (type/vector/enum/min/max/default/nullable). It stops emitting
  tooltip-derived `description` values into the returned options.
- `index.ts` loads `schema/descriptions.json` and sets each output
  entry's `description` from the overlay. Keys without an overlay entry
  are emitted without a `description` field.
- After writing the schema files, the generator prints a coverage
  report to stderr: count and list of keys (per kind) that have no
  overlay entry. A missing overlay file is an error.
- Overlay entries whose key matches no parsed option are reported as
  stale (warning, not an error — they may belong to another Bambu
  version).

The schema entry shape is unchanged (`description?: string`), so
`list_parameters`, the validator, and all consumers need no changes.

## Authoring and migration process

1. Initial authoring covers every key currently emitted into either
   schema. Batch work (~40 keys per batch) by agents under the style
   contract and clean-room rule, followed by spot review per batch.
2. Regenerate both schemas from the overlay; verify by search that no
   distributed description matches BambuStudio tooltip text and that
   coverage is 100% for the current key set.
3. After a Bambu Studio update introduces new keys, the coverage report
   names them; they ship description-less until authored. Authoring new
   entries follows the same contract.

## Testing

- Generator unit tests (existing fixture-based suite) updated: the
  fixture run asserts tooltip text does NOT appear in output
  descriptions, overlay values DO, uncovered keys have no `description`
  field, and stale overlay keys produce the warning.
- `list_parameters` tests keep passing against the updated fixture
  schemas (fixture schema descriptions become fixture overlay entries).

## Out of scope

- Rewriting `label` values (extracted short functional names remain).
- Localization of descriptions.
- Any runtime behavior change in the server.
- Retroactively rewriting descriptions in already-distributed copies
  (the repo is the single distribution point).
