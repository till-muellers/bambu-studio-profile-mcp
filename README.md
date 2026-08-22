# printing-profile-mcp

An MCP (Model Context Protocol) server for managing 3D printing slicer profiles, currently targeting Bambu Studio.

## Tools

- `resolve_process_profile` / `resolve_filament_profile` — resolve a profile's fully-merged active settings by walking its `inherits` chain across the configured user preset store and system profiles.
- `write_process_profile` / `write_filament_profile` — create a profile file in a caller-chosen output directory from a base profile plus schema-validated key-value overrides. Bambu Studio's own directories are never written; importing profiles into Bambu Studio is a planned later feature.
- `list_profiles` — discover process or filament profiles (`kind` argument) in the user preset store and system store, optionally scoped to a vendor and filtered by a case-insensitive name substring; results feed the vendor/name/baseProfile arguments of the resolve/write tools.
- `list_vendors` — list vendor folder ids under `resources/profiles` with their display names; the id feeds the vendor arguments of the resolve/write/list_profiles tools.
- `list_parameters` — discover the option keys valid for process or filament profiles (`kind` argument), with type, range/enum, default, and (where available) a display label and description; filterable by a case-insensitive substring against key, label, or description. Results feed the `kvps` argument of the write tools.
- `list_filaments` — list the distinct `filament_id` values across all filament profiles (user store plus every vendor's system filament directory) with their display names.
- `init_config` — set and persist `installDir`/`userDataDir`/`userId`. Required once; all three are auto-detected when omitted (`userId` from `BambuStudio.conf`'s `app.preset_folder`).

## Setup (Windows)

```powershell
npm install
npm run build
```

Register with Claude Code:

```powershell
claude mcp add printing-profiles -- node <checkout>\dist\index.js
```

Then call `init_config` once; with Bambu Studio installed and logged in, no arguments are needed (paths and `userId` are auto-detected). Pass `userId` explicitly to target a different account folder, such as `default` when not logged in. Configuration persists in `config.json` (gitignored, machine-specific).

## Regenerating the option schemas

`schema/*.schema.json` are generated from the BambuStudio source matching the installed version. After a Bambu Studio update:

```powershell
git clone --depth 1 --branch <matching-version-tag> https://github.com/bambulab/BambuStudio C:\temp\BambuStudio
npx tsx scripts/generate-schema/index.ts C:\temp\BambuStudio
```

## Development

```powershell
npm test
```

## License

Private / unlicensed.
