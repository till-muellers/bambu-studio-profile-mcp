import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strings } from "../strings.js";
import { resolveProfile } from "../resolver.js";
import type { ReadableProfileKind, ResolvedProfile } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { projectKeys } from "./project-keys.js";

export async function handleResolve(
  deps: ToolDeps,
  kind: ReadableProfileKind,
  args: { vendor: string; name: string; keys?: string[] }
): Promise<ResolvedProfile> {
  const cfg = await deps.config.require();
  const store = deps.storeFactory(cfg);
  const resolved = await resolveProfile(store, kind, args.vendor, args.name);
  if (args.keys === undefined) return resolved;
  const { settings, missingKeys } = projectKeys(resolved.settings, args.keys);
  return { ...resolved, settings, missingKeys };
}

const resolveInputShape = {
  kind: z.enum(["process", "filament", "machine"]).describe(strings.tools.resolveProfile.inputs.kind),
  vendor: z
    .string()
    .min(1)
    .describe(strings.tools.resolveProfile.inputs.vendor),
  name: z
    .string()
    .min(1)
    .describe(strings.tools.resolveProfile.inputs.name),
  keys: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(strings.tools.resolveProfile.inputs.keys),
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
    async (args: { kind: ReadableProfileKind; vendor: string; name: string; keys?: string[] }) => {
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
