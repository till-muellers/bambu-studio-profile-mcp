import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { strings } from "../strings.js";
import { resolveProfile } from "../resolver.js";
import type { ReadableProfileKind, ResolvedProfile } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { nilResolutionOptions } from "./nil-options.js";
import { projectResolved } from "./project-keys.js";

export async function handleResolve(
  deps: ToolDeps,
  kind: ReadableProfileKind,
  args: { vendor: string; name: string; keys?: string[]; machineName?: string }
): Promise<ResolvedProfile> {
  const cfg = await deps.config.require();
  const store = deps.storeFactory(cfg);
  const options = await nilResolutionOptions(deps, store, kind, args.vendor, args.machineName);
  const resolved = await resolveProfile(store, kind, args.vendor, args.name, options);
  if (args.keys === undefined) return resolved;
  return projectResolved(resolved, args.keys);
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
  machineName: z
    .string()
    .min(1)
    .optional()
    .describe(strings.tools.resolveProfile.inputs.machineName),
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
    async (args: {
      kind: ReadableProfileKind;
      vendor: string;
      name: string;
      keys?: string[];
      machineName?: string;
    }) => {
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
