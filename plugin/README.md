# bambu-studio-profiles

Claude Code plugin for Bambu Studio printing-profile work. Installing it registers the
`bambu-profiles` MCP server (`npx -y bambu-studio-profile-mcp`) and adds three skills:

- **profile-workspace-init** — configure the server, elicit the target printer, probe the
  machine preset for its extruder-variant columns, and record the project's printing facts
  in its `CLAUDE.md`.
- **profile-authoring** — author schema-validated minimal-delta presets and install them,
  carrying the tool decision matrix that maps each question to the tool answering it.
- **profile-drift** — detect and reconcile drift between project profile files and the
  presets installed in Bambu Studio, harvesting hand-tuned values.

Requires Node.js 20+ and a local Bambu Studio installation. Server documentation:
https://github.com/till-muellers/bambu-studio-profile-mcp
