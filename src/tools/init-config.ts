import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateConfigPaths } from "../config.js";
import type { ServerConfig } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleInitConfig(
  deps: ToolDeps,
  args: { installDir?: string; userDataDir?: string; userId: string }
): Promise<ServerConfig & { persistedTo: string }> {
  const detected = args.installDir && args.userDataDir ? {} : await deps.detectPaths();
  const installDir = args.installDir ?? detected.installDir;
  const userDataDir = args.userDataDir ?? detected.userDataDir;

  const missing: string[] = [];
  if (!installDir) missing.push("installDir");
  if (!userDataDir) missing.push("userDataDir");
  if (missing.length > 0 || !installDir || !userDataDir) {
    throw new Error(
      `Auto-detection could not determine: ${missing.join(", ")}. Pass ${missing.join(" and ")} explicitly.`
    );
  }

  const cfg: ServerConfig = { installDir, userDataDir, userId: args.userId };
  const problems = await validateConfigPaths(cfg);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const persistedTo = await deps.config.save(cfg);
  return { ...cfg, persistedTo };
}

const initConfigInputShape = {
  installDir: z
    .string()
    .min(1)
    .optional()
    .describe("Bambu Studio install dir containing resources/profiles; auto-detected if omitted"),
  userDataDir: z
    .string()
    .min(1)
    .optional()
    .describe("Bambu Studio user-data dir containing the user/ preset store; auto-detected if omitted"),
  userId: z
    .string()
    .min(1)
    .describe("The user/<userId> directory resolution reads (a cloud-account id or 'default'); never auto-detected"),
};

export function registerInitConfigTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "init_config",
    {
      title: "Initialize configuration",
      description:
        `Set and persist the Bambu Studio installDir, userDataDir, and userId used by all other tools. ` +
        `Required once before any resolve/write call succeeds. installDir/userDataDir are auto-detected ` +
        `when omitted; userId must always be given. Takes effect immediately — no server restart needed.\n\n` +
        `Args:\n  - installDir (string, optional): must contain resources/profiles\n` +
        `  - userDataDir (string, optional): must contain the user/ preset store\n` +
        `  - userId (string): the user/<userId> directory resolution reads\n\n` +
        `Returns: { installDir, userDataDir, userId, persistedTo }\n\n` +
        `Errors: each invalid or undetectable value is reported; nothing is persisted on failure.`,
      inputSchema: initConfigInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { installDir?: string; userDataDir?: string; userId: string }) => {
      try {
        const result = await handleInitConfig(deps, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
