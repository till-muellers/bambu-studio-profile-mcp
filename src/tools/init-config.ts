import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { readPresetFolder, validateConfigPaths } from "../config.js";
import { strings } from "../strings.js";
import type { ServerConfig } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleInitConfig(
  deps: ToolDeps,
  args: { installDir?: string; userDataDir?: string; userId?: string }
): Promise<ServerConfig & { persistedTo: string }> {
  const detected = args.installDir && args.userDataDir ? {} : await deps.detectPaths();
  const installDir = args.installDir ?? detected.installDir;
  const userDataDir = args.userDataDir ?? detected.userDataDir;

  const missing: string[] = [];
  if (!installDir) missing.push("installDir");
  if (!userDataDir) missing.push("userDataDir");
  if (missing.length > 0 || !installDir || !userDataDir) {
    throw new Error(strings.messages.detectionFailed(missing));
  }

  let userId = args.userId;
  if (!userId) {
    const confPath = join(userDataDir, "BambuStudio.conf");
    userId = await readPresetFolder(userDataDir);
    if (!userId) {
      throw new Error(strings.messages.userIdNotDetected(confPath));
    }
  }

  const cfg: ServerConfig = { installDir, userDataDir, userId };
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
    .describe(strings.tools.initConfig.inputs.installDir),
  userDataDir: z
    .string()
    .min(1)
    .optional()
    .describe(strings.tools.initConfig.inputs.userDataDir),
  userId: z
    .string()
    .min(1)
    .optional()
    .describe(strings.tools.initConfig.inputs.userId),
};

export function registerInitConfigTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "init_config",
    {
      title: strings.tools.initConfig.title,
      description: strings.tools.initConfig.description,
      inputSchema: initConfigInputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { installDir?: string; userDataDir?: string; userId?: string }) => {
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
