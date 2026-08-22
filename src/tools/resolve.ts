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
  kind: z.enum(["process", "filament"]).describe("Profile type to resolve"),
  vendor: z
    .string()
    .min(1)
    .describe(
      "Vendor id from list_vendors, e.g. 'BBL'. Required for user presets too: it names the system " +
        "store their inherits chain can reference"
    ),
  name: z
    .string()
    .min(1)
    .describe("Exact profile name as returned by list_profiles (the 'name' field inside the profile JSON)"),
};

export function registerResolveTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "resolve_profile",
    {
      title: "Resolve profile",
      description:
        "Resolve a Bambu Studio process or filament profile's fully-merged active settings. Walks the " +
        "profile's 'inherits' chain across the configured user preset store and the vendor's system " +
        "profiles, merging settings root-first so a more specific profile's values override its " +
        "ancestors'.\n\n" +
        "Returns: { vendor, name, kind, chain: string[] (root-first), settings: object } — settings is " +
        "the flat merged key->value map; scalar options are bare strings like \"0.2\", per-extruder " +
        "options are string arrays like [\"250\",\"500\",\"500\"].\n\n" +
        "Errors: vendor not found; profile not found; circular or unresolvable inherits chain; config " +
        "missing (run init_config first).\n\n" +
        "Discover valid vendor and name values with list_vendors and list_profiles. Typical use: inspect " +
        "a profile's effective settings before creating a variant of it with write_profile.",
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
