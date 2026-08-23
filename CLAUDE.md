# printing-profile-mcp

TypeScript MCP server (stdio) for Bambu Studio printing profiles. Specs and plans live in `docs/superpowers/`.

## Commands

- `npm test` — full suite; `npx vitest run <file>` — single file
- `npm run build` — tsc to `dist/`
- Schema regeneration: `npx tsx scripts/generate-schema/index.ts <BambuStudio-checkout>` (clone the release tag matching the installed Studio version; never clone into this repo)

## Invariants

- All user-facing strings (tool descriptions, `.describe` texts, error messages, violation reasons, warnings) live in `src/strings.ts`. Extend the module; never inline a user-facing literal elsewhere in `src/`.
- Tool descriptions: Purpose / Returns / Errors / cross-tool pointers; parameter detail only in zod `.describe` texts; no negations, no roadmap commentary.
- `schema/*.schema.json` are GENERATED — never hand-edit. Facts come from the parser; descriptions come from `schema/descriptions.json` only.
- `schema/descriptions.json` is original, project-authored text. Clean-room rule: author from key/label/type/range facts plus FDM domain knowledge; BambuStudio tooltip text (it lives in PrintConfig.cpp) must never enter an authoring prompt or the shipped files.
- `src/types.ts` and `src/errors.ts` are locked contracts — extend additively only, with review.
- Tool handlers are plain exported functions (`handleX(deps, args)`); registerTool callbacks stay thin. Tools register via `server.registerTool()` only.
- Bambu Studio directories are read-only for every tool except `import_profile`/`remove_profile`, which touch only `user/<userId>/<kind>/` under their safety contracts (`from: "User"` checks, validation before any write).
- Preset names never carry path separators or dot segments — `userPresetPaths` is the guard; route any new user-store path building through it.

## Domain knowledge

- Bambu Studio behavior contracts (user-preset format, `.info` sidecars, cloud-only ids, vector/nil semantics, startup-only rescans, Studio deleting unparseable presets) live in `docs/superpowers/specs/2026-08-22-bambu-studio-profile-mcp-design.md` — read the relevant section before touching store/validator/import code.
- `BambuStudio.conf` is JSON followed by a `# MD5 checksum` trailer line — parse by slicing first `{` to last `}` (see `readPresetFolder`).

## Testing conventions

- vitest excludes `.claude/**` (agent worktrees) from collection.
- Tests never write into `tests/fixtures/` — writable stores are mkdtemp temp dirs.
- Every new tool gets a protocol-level test in `tests/server.test.ts` plus its entry in the sorted tool-name array.

## Multi-session / worktree protocol

- The shared checkout's HEAD is never a merge target: check `git branch --show-current` first, coordinate via cross-session message, single integrator per repo.
- Agent worktrees branch from origin/main — bring local unpushed commits in explicitly (`git merge <sha>`); their absence is silent.
