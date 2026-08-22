import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
  kind: z.enum(["process", "filament"]).describe("Which profile store to resolve from"),
  vendor: z.string().min(1).describe("Vendor folder under resources/profiles, e.g. 'BBL'"),
  name: z.string().min(1).describe("Profile name (the 'name' field inside the profile JSON)"),
};

export function registerResolveTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "resolve_profile",
    {
      title: "Resolve profile",
      description:
        "Resolve a Bambu Studio process or filament profile's fully-merged active settings. Walks the " +
        "profile's 'inherits' chain across the configured user preset store and the system profiles of " +
        "the given vendor, merging settings root-first so a more specific profile's values override " +
        "its ancestors'.\n\n" +
        "Args:\n  - kind (\"process\" | \"filament\"): which profile store to resolve from\n" +
        "  - vendor (string): vendor folder under resources/profiles, e.g. 'BBL'\n" +
        "  - name (string): profile name as shown in the profile JSON 'name' field\n\n" +
        "Returns: { vendor, name, kind, chain: string[] (root-first), settings: object (flat merged " +
        "key->value map; scalars are bare strings, per-extruder options are string arrays) }\n\n" +
        "Errors: vendor not found; profile not found; circular or unresolvable inherits chain; config " +
        "missing (fix via init_config).\n\n" +
        "Find valid vendor and name values with list_vendors and list_profiles.",
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
