#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigManager, detectDefaultPaths } from "./config.js";
import { FsProfileStore } from "./profile-store.js";
import { type ToolDeps } from "./tools/deps.js";
import { registerInitConfigTool } from "./tools/init-config.js";
import { registerResolveTools } from "./tools/resolve.js";
import { registerWriteTools } from "./tools/write.js";

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "printing-profile-mcp", version: "0.1.0" });
  registerResolveTools(server, deps);
  registerWriteTools(server, deps);
  registerInitConfigTool(server, deps);
  return server;
}

async function main(): Promise<void> {
  // Project root = one level above dist/ (this file compiles to dist/index.js).
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const deps: ToolDeps = {
    config: new ConfigManager(join(projectRoot, "config.json")),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(projectRoot, "schema"),
    detectPaths: detectDefaultPaths,
  };
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  console.error("printing-profile-mcp running on stdio");
}

// Only start the transport when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
