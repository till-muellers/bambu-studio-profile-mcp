# printing-profile-mcp

An MCP (Model Context Protocol) server for managing 3D printing slicer profiles, currently targeting Bambu Studio.

## Tools

- `resolve_profile` — resolve a process or filament profile's (`kind` argument) fully-merged active settings by walking its `inherits` chain across the configured user preset store and system profiles.
- `write_profile` — create a process or filament profile file (`kind` argument) in a caller-chosen output directory from a base profile plus schema-validated key-value overrides. Bambu Studio's own directories are never written by write_profile.
- `update_profile` — incrementally edit a profile file previously created by `write_profile`: upsert `set` keys and delete `remove` keys in one atomic, schema-validated step, leaving unmentioned keys and the file's `name`/`inherits` untouched.
- `import_profile` — install a written profile file into Bambu Studio's user preset store (metadata and `.info` sidecar synthesized; overwrite requires an explicit flag; Bambu Studio sees it after a restart).
- `remove_profile` — delete a user preset (JSON + `.info`) from the store; only presets marked `"from": "User"`; flags presets that have a cloud record.
- `list_profiles` — discover process or filament profiles (`kind` argument) in the user preset store and system store, optionally scoped to a vendor and filtered by a case-insensitive name substring; results feed the vendor/name/baseProfile arguments of the resolve/write tools.
- `list_vendors` — list vendor folder ids under `resources/profiles` with their display names; the id feeds the vendor arguments of the resolve/write/list_profiles tools.
- `list_parameters` — discover the option keys valid for process or filament profiles (`kind` argument), with type, range/enum, default, and (where available) a display label and description; filterable by a case-insensitive substring against key, label, or description. Results feed the `kvps` argument of the write tools.
- `list_filaments` — list the distinct `filament_id` values across all filament profiles (user store plus every vendor's system filament directory) with their display names.
- `init_config` — set and persist `installDir`/`userDataDir`/`userId`. Required once; all three are auto-detected when omitted (`userId` from `BambuStudio.conf`'s `app.preset_folder`).

## Setup (Windows)

```powershell
claude mcp add printing-profiles -- npx -y github:till-muellers/printing-profile-mcp
```

Then call `init_config` once; with Bambu Studio installed and logged in, no arguments are needed (paths and `userId` are auto-detected). Pass `userId` explicitly to target a different account folder, such as `default` when not logged in.

Configuration persists per project in `.printing-profile-mcp\config.json`. Add `.printing-profile-mcp/` to the project's `.gitignore` (it is machine-specific). The config directory resolves at server start (first match wins):

1. `PRINTING_PROFILE_MCP_CONFIG_DIR` — used as the config directory verbatim, for clients that set neither of the below.
2. `CLAUDE_PROJECT_DIR` — set by Claude Code for stdio MCP servers; config dir is `<CLAUDE_PROJECT_DIR>\.printing-profile-mcp`.
3. The current working directory — fallback; config dir is `<cwd>\.printing-profile-mcp`.

## Development

```powershell
git clone https://github.com/till-muellers/printing-profile-mcp.git
cd printing-profile-mcp
npm install
npm run build
```

Register the local build with Claude Code:

```powershell
claude mcp add printing-profiles -- node <checkout>\dist\index.js
```

Run tests:

```powershell
npm test
```

## Regenerating the option schemas

`schema/*.schema.json` are generated from the BambuStudio source matching the installed version. After a Bambu Studio update:

```powershell
git clone --depth 1 --branch <matching-version-tag> https://github.com/bambulab/BambuStudio C:\temp\BambuStudio
npx tsx scripts/generate-schema/index.ts C:\temp\BambuStudio
```

## License

Private / unlicensed.
