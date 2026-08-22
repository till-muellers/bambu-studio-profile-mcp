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
  vendor: z.string().min(1).describe("Vendor folder under resources/profiles, e.g. 'BBL'"),
  name: z.string().min(1).describe("Profile name (the 'name' field inside the profile JSON)"),
};

function register(server: McpServer, deps: ToolDeps, kind: ProfileKind): void {
  server.registerTool(
    `resolve_${kind}_profile`,
    {
      title: `Resolve ${kind} profile`,
      description:
        `Resolve a Bambu Studio ${kind} profile's fully-merged active settings by walking its ` +
        `'inherits' chain across the configured user preset store and the system profiles of the given vendor.\n\n` +
        `Args:\n  - vendor (string): vendor folder under resources/profiles, e.g. 'BBL'\n` +
        `  - name (string): profile name as shown in the profile JSON 'name' field\n\n` +
        `Returns: { vendor, name, kind, chain: string[] (root-first), settings: object (flat merged key->value map; ` +
        `scalars are bare strings, per-extruder options are string arrays) }\n\n` +
        `Errors: vendor not found; profile not found; circular or unresolvable inherits chain; ` +
        `config missing (fix via init_config).`,
      inputSchema: resolveInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { vendor: string; name: string }) => {
      try {
        const result = await handleResolve(deps, kind, args);
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

export function registerResolveTools(server: McpServer, deps: ToolDeps): void {
  register(server, deps, "process");
  register(server, deps, "filament");
}
