# bambu-studio-profile-mcp

[![npm](https://img.shields.io/npm/v/bambu-studio-profile-mcp)](https://www.npmjs.com/package/bambu-studio-profile-mcp)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

An MCP (Model Context Protocol) server that lets AI agents read, create, edit, and install [Bambu Studio](https://bambulab.com/en/download/studio) printing profiles — process and filament presets — with every parameter validated against the slicer's own option schema.

> Community project. Not affiliated with or endorsed by Bambu Lab.

## What it does

- **Resolve** any profile's fully-merged settings by walking its `inherits` chain across system and user presets.
- **Discover** profiles, vendors, filaments, and the tunable parameters (typed, ranged, and described for agents).
- **Write and edit** profile files in your project, schema-validated on every change.
- **Import** finished profiles into Bambu Studio's user preset store — and remove them again — under strict safety rules (only user presets are ever touched; Studio's own directories stay read-only otherwise).

Requires Node.js 20+ and a local Bambu Studio installation.

## Quick start (Claude Code)

```powershell
claude mcp add bambu-profiles --scope user -- npx -y bambu-studio-profile-mcp
```

Then ask your agent to call `init_config` once per project — with Bambu Studio installed and logged in, no arguments are needed.

## Installing in other clients

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit the config file (Settings → Developer → Edit Config):

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bambu-profiles": {
      "command": "npx",
      "args": ["-y", "bambu-studio-profile-mcp"],
      "env": {
        "BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR": "C:\\Users\\you\\bambu-profiles-config"
      }
    }
  }
}
```

Claude Desktop has no project directory, so set `BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR` to an absolute path where the server should keep its config. Fully restart Claude Desktop afterwards. Logs live in `%APPDATA%\Claude\logs\mcp*.log`.

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

```powershell
copilot mcp add bambu-profiles -- npx -y bambu-studio-profile-mcp
```

Or use the interactive `/mcp add` wizard inside `copilot`, or edit `~/.copilot/mcp-config.json` directly:

```json
{
  "mcpServers": {
    "bambu-profiles": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "bambu-studio-profile-mcp"],
      "tools": ["*"]
    }
  }
}
```

</details>

<details>
<summary><strong>Google Antigravity</strong></summary>

Agent side panel → `…` → MCP Servers → Manage MCP Servers → View raw config (file: `~/.gemini/config/mcp_config.json`, or workspace-local `.agents/mcp_config.json`). On Windows, wrap the command in `cmd /c` as the Antigravity docs require:

```json
{
  "mcpServers": {
    "bambu-profiles": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "bambu-studio-profile-mcp"]
    }
  }
}
```

On macOS/Linux use `"command": "npx", "args": ["-y", "bambu-studio-profile-mcp"]`.

</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

```powershell
codex mcp add bambu-profiles -- npx -y bambu-studio-profile-mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.bambu-profiles]
command = "npx"
args = ["-y", "bambu-studio-profile-mcp"]
```

If the server fails to spawn on native Windows, use `command = "cmd"` with `args = ["/c", "npx", "-y", "bambu-studio-profile-mcp"]` — a known community workaround, not part of the official docs.

</details>

<details>
<summary><strong>Any other MCP client</strong></summary>

The server speaks stdio; the generic shape most clients accept:

```json
{
  "mcpServers": {
    "bambu-profiles": {
      "command": "npx",
      "args": ["-y", "bambu-studio-profile-mcp"],
      "env": {
        "BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR": "C:\\path\\to\\config"
      }
    }
  }
}
```

`env` is optional — set it when the client does not launch servers from a meaningful working directory (see Configuration below).

</details>

## Configuration

Call the `init_config` tool once per project; with Bambu Studio installed and logged in, no arguments are needed (install path, user data path, and account id are auto-detected). Pass `userId` explicitly to target a different account folder, such as `default` when not logged in.

Configuration persists per project in `.bambu-studio-profile-mcp\config.json`. Add `.bambu-studio-profile-mcp/` to the project's `.gitignore` (it is machine-specific). The config directory resolves at server start (first match wins):

1. `BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR` — used as the config directory verbatim, for clients that set neither of the below.
2. `CLAUDE_PROJECT_DIR` — set by Claude Code for stdio MCP servers; config dir is `<CLAUDE_PROJECT_DIR>\.bambu-studio-profile-mcp`.
3. The current working directory — fallback; config dir is `<cwd>\.bambu-studio-profile-mcp`.

## Tools

| Tool | Purpose |
| --- | --- |
| `init_config` | Set and persist `installDir` / `userDataDir` / `userId`; all auto-detected when omitted. |
| `list_profiles` | Discover process or filament profiles, optionally scoped to a vendor and filtered by name substring. |
| `list_vendors` | List vendor ids under `resources/profiles` with display names. |
| `list_filaments` | List distinct `filament_id` values across all filament profiles with display names. |
| `list_parameters` | Discover valid option keys per profile kind — type, range/enum, default, label, description. |
| `resolve_profile` | Resolve a profile's fully-merged active settings across its `inherits` chain. |
| `write_profile` | Create a profile file in a caller-chosen directory from a base profile plus validated overrides. |
| `update_profile` | Atomically upsert and delete keys in a previously written profile file. |
| `import_profile` | Install a written profile into Bambu Studio's user preset store (`.info` sidecar synthesized; overwrite requires an explicit flag; Studio sees it after a restart). |
| `remove_profile` | Delete a user preset (JSON + `.info`) from the store; only presets marked `"from": "User"`. |

A typical session: `list_profiles` to find a base → `resolve_profile` to inspect it → `write_profile` with overrides → iterate via `update_profile` → `import_profile` → restart Bambu Studio.

## Regenerating the option schemas

`schema/*.schema.json` are generated from the Bambu Studio source matching the installed version. After a Bambu Studio update:

```powershell
git clone --depth 1 --branch <matching-version-tag> https://github.com/bambulab/BambuStudio C:\temp\BambuStudio
npx tsx scripts/generate-schema/index.ts C:\temp\BambuStudio
```

## Development

```powershell
git clone https://github.com/till-muellers/bambu-studio-profile-mcp.git
cd bambu-studio-profile-mcp
npm install
npm run build
npm test
```

Register the local build with Claude Code:

```powershell
claude mcp add bambu-profiles -- node <absolute-path-to-checkout>\dist\index.js
```

## License

[AGPL-3.0](LICENSE), matching Bambu Studio's license. The option schemas in `schema/` are generated from the [Bambu Studio](https://github.com/bambulab/BambuStudio) source (AGPL-3.0, © Bambu Lab and contributors); the parameter description texts are original to this project.
