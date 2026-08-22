# printing-profile-mcp

An MCP (Model Context Protocol) server for managing 3D printing slicer profiles, currently targeting Bambu Studio.

## Tools

- `resolve_process_profile` / `resolve_filament_profile` — resolve a profile's fully-merged active settings by walking its `inherits` chain across the configured user preset store and system profiles.
- `write_process_profile` / `write_filament_profile` — create a profile file in a caller-chosen output directory from a base profile plus schema-validated key-value overrides. Bambu Studio's own directories are never written; importing profiles into Bambu Studio is a planned later feature.
- `init_config` — set and persist `installDir`/`userDataDir`/`userId`. Required once; paths are auto-detected when omitted, `userId` never is.

## Setup (Windows)

```powershell
npm install
npm run build
```

Register with Claude Code:

```powershell
claude mcp add printing-profiles -- node <checkout>\dist\index.js
```

Then call the `init_config` tool once with your `userId` — the `user\<id>` folder name under `%APPDATA%\BambuStudio\user` (a numeric cloud-account id, or `default` when not logged in). Configuration persists in `config.json` (gitignored, machine-specific).

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
