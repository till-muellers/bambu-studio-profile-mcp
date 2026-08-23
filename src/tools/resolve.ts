import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strings } from "../strings.js";
import { resolveProfile } from "../resolver.js";
import type { ProfileKind, ResolvedProfile } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleResolve(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; name: string }
): Promise<ResolvedProfile> {
  const cfg = await deps.config.require();
  const store = deps.storeFactory(cfg);
  return resolveProfile(store, kind, args.vendor, args.name);
}

const resolveInputShape = {
  kind: z.enum(["process", "filament"]).describe(strings.tools.resolveProfile.inputs.kind),
  vendor: z
    .string()
    .min(1)
    .describe(strings.tools.resolveProfile.inputs.vendor),
  name: z
    .string()
    .min(1)
    .describe(strings.tools.resolveProfile.inputs.name),
};

export function registerResolveTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "resolve_profile",
    {
      title: strings.tools.resolveProfile.title,
      description: strings.tools.resolveProfile.description,
      inputSchema: resolveInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; vendor: string; name: string }) => {
      try {
        const result = await handleResolve(deps, args.kind, args);
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
