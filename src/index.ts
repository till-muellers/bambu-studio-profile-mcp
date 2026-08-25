#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager, detectDefaultPaths, resolveConfigDir } from "./config.js";
import { strings } from "./strings.js";
import { FsProfileStore } from "./profile-store.js";
import { type ToolDeps } from "./tools/deps.js";
import { registerCompareTool } from "./tools/compare.js";
import { registerDiffTool } from "./tools/diff.js";
import { registerInitConfigTool } from "./tools/init-config.js";
import { registerImportTools } from "./tools/import.js";
import { registerListTools } from "./tools/list.js";
import { registerResolveTools } from "./tools/resolve.js";
import { registerResolveFromFileTool } from "./tools/resolve-from-file.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerWriteTools } from "./tools/write.js";

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: "bambu-studio-profile-mcp", version: "0.1.0" },
    { capabilities: { logging: {} } }
  );
  registerResolveTools(server, deps);
  registerWriteTools(server, deps);
  registerImportTools(server, deps);
  registerUpdateTool(server, deps);
  registerInitConfigTool(server, deps);
  registerListTools(server, deps);
  registerDiffTool(server, deps);
  registerResolveFromFileTool(server, deps);
  registerCompareTool(server, deps);
  return server;
}

/**
 * Best-effort: if no per-project config exists yet, log to stderr and send an MCP logging
 * notification telling the client to call init_config. Never throws — a notification failure
 * (e.g. no connected transport) must not crash the server.
 */
export async function warnIfUnconfigured(server: McpServer, deps: ToolDeps): Promise<void> {
  const cfg = await deps.config.load();
  if (cfg) return;
  console.error(strings.warnings.unconfiguredStderr);
  try {
    await server.server.sendLoggingMessage({
      level: "warning",
      logger: "bambu-studio-profile-mcp",
      data: strings.warnings.unconfiguredNotification,
    });
  } catch {
    // Best-effort only — no connected client, or the client hasn't negotiated logging.
  }
}

async function main(): Promise<void> {
  // Project root = one level above dist/ (this file compiles to dist/index.js).
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const deps: ToolDeps = {
    config: new ConfigManager(join(resolveConfigDir(process.env, process.cwd()), "config.json")),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(projectRoot, "schema"),
    detectPaths: detectDefaultPaths,
  };
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  console.error("bambu-studio-profile-mcp running on stdio");
  await warnIfUnconfigured(server, deps);
}

// Only start the transport when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
