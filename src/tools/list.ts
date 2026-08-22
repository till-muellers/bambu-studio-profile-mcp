import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listProfiles, listVendors, type ProfileListing } from "../profile-store.js";
import type { ProfileKind } from "../types.js";
import { toToolError, type ToolDeps } from "./deps.js";

export async function handleListProfiles(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor?: string; nameContains?: string }
): Promise<{ kind: ProfileKind; profiles: ProfileListing[] }> {
  const cfg = await deps.config.require();
  let profiles = await listProfiles(cfg, kind, args.vendor);
  if (args.nameContains) {
    const needle = args.nameContains.toLowerCase();
    profiles = profiles.filter((p) => p.name.toLowerCase().includes(needle));
  }
  return { kind, profiles };
}

export async function handleListVendors(
  deps: ToolDeps
): Promise<{ vendors: { name: string; processCount: number; filamentCount: number }[] }> {
  const cfg = await deps.config.require();
  const vendors = await listVendors(cfg);
  return { vendors };
}

const listProfilesInputShape = {
  vendor: z.string().min(1).optional().describe("Vendor folder under resources/profiles, e.g. 'BBL'; omit to search every vendor"),
  nameContains: z.string().min(1).optional().describe("Case-insensitive substring filter on the profile name"),
};

function registerListProfiles(server: McpServer, deps: ToolDeps, kind: ProfileKind): void {
  server.registerTool(
    `list_${kind}_profiles`,
    {
      title: `List ${kind} profiles`,
      description:
        `Discover ${kind} profiles available in the user preset store and the system store. Omit vendor ` +
        `to search every vendor; nameContains narrows results by a case-insensitive substring match. Results ` +
        `feed the vendor/name/baseProfile arguments of the resolve_${kind}_profile and write_${kind}_profile tools.\n\n` +
        `Args:\n  - vendor (string, optional): vendor folder under resources/profiles, e.g. 'BBL'\n` +
        `  - nameContains (string, optional): case-insensitive substring filter on the profile name\n\n` +
        `Returns: { kind, profiles: [{ name, source: "user"|"system", vendor?, inherits? }] }\n\n` +
        `Errors: vendor not found (only when vendor is given); config missing (fix via init_config).`,
      inputSchema: listProfilesInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { vendor?: string; nameContains?: string }) => {
      try {
        const result = await handleListProfiles(deps, kind, args);
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

function registerListVendors(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_vendors",
    {
      title: "List vendors",
      description:
        `List the vendor folders under resources/profiles, each with its process and filament profile counts. ` +
        `Use this to discover valid vendor arguments for the resolve/write/list profile tools.\n\n` +
        `Returns: { vendors: [{ name, processCount, filamentCount }] }\n\n` +
        `Errors: config missing (fix via init_config).`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await handleListVendors(deps);
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

export function registerListTools(server: McpServer, deps: ToolDeps): void {
  registerListProfiles(server, deps, "process");
  registerListProfiles(server, deps, "filament");
  registerListVendors(server, deps);
}
