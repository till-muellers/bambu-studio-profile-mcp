import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { listFilaments, listProfiles, listVendors, type ProfileListing } from "../profile-store.js";
import type { ProfileKind, SchemaOption } from "../types.js";
import { loadSchema } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

const kindEnum = z.enum(["process", "filament"]);

export interface ParameterListing extends SchemaOption {
  key: string;
}

export async function handleListProfiles(
  deps: ToolDeps,
  args: { kind: ProfileKind; vendor?: string; search?: string }
): Promise<{ kind: ProfileKind; profiles: ProfileListing[] }> {
  const cfg = await deps.config.require();
  let profiles = await listProfiles(cfg, args.kind, args.vendor);
  if (args.search) {
    const needle = args.search.toLowerCase();
    profiles = profiles.filter((p) => p.name.toLowerCase().includes(needle));
  }
  return { kind: args.kind, profiles };
}

export async function handleListVendors(
  deps: ToolDeps
): Promise<{ vendors: { id: string; name: string }[] }> {
  const cfg = await deps.config.require();
  const vendors = await listVendors(cfg);
  return { vendors };
}

export async function handleListParameters(
  deps: ToolDeps,
  args: { kind: ProfileKind; search?: string }
): Promise<{ kind: ProfileKind; parameters: ParameterListing[] }> {
  await deps.config.require();
  const schema = await loadSchema(join(deps.schemaDir, `${args.kind}.schema.json`));
  let parameters: ParameterListing[] = Object.entries(schema).map(([key, option]) => ({ key, ...option }));
  if (args.search) {
    const needle = args.search.toLowerCase();
    parameters = parameters.filter(
      (p) =>
        p.key.toLowerCase().includes(needle) ||
        (p.label ?? "").toLowerCase().includes(needle) ||
        (p.description ?? "").toLowerCase().includes(needle)
    );
  }
  return { kind: args.kind, parameters };
}

export async function handleListFilaments(
  deps: ToolDeps
): Promise<{ filaments: { id: string; name: string }[] }> {
  const cfg = await deps.config.require();
  const filaments = await listFilaments(cfg);
  return { filaments };
}

function registerListProfiles(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_profiles",
    {
      title: "List profiles",
      description:
        "Discover process or filament profiles available in the user preset store and the system store. " +
        "Omit vendor to search every vendor; search narrows results by a case-insensitive substring match " +
        "on the profile name. Results feed the vendor/name/baseProfile arguments of the resolve_<kind>_profile " +
        "and write_<kind>_profile tools.\n\n" +
        "Args:\n  - kind (\"process\" | \"filament\"): which profile store to list\n" +
        "  - vendor (string, optional): vendor folder under resources/profiles, e.g. 'BBL'\n" +
        "  - search (string, optional): case-insensitive substring filter on the profile name\n\n" +
        "Returns: { kind, profiles: [{ name, source: \"user\"|\"system\", vendor?, inherits? }] }\n\n" +
        "Errors: vendor not found (only when vendor is given); config missing (fix via init_config).",
      inputSchema: {
        kind: kindEnum.describe("Which profile store to list"),
        vendor: z.string().min(1).optional().describe("Vendor folder under resources/profiles, e.g. 'BBL'; omit to search every vendor"),
        search: z.string().min(1).optional().describe("Case-insensitive substring filter on the profile name"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; vendor?: string; search?: string }) => {
      try {
        const result = await handleListProfiles(deps, args);
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
        "List the vendor folders under resources/profiles with their display names. Use this to discover " +
        "valid vendor arguments (the id) for the resolve/write/list_profiles tools.\n\n" +
        "Returns: { vendors: [{ id, name }] } (sorted by id)\n\n" +
        "Errors: config missing (fix via init_config).",
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

function registerListParameters(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_parameters",
    {
      title: "List parameters",
      description:
        "Discover the option keys valid for process or filament profiles, with their type, range/enum, " +
        "default, and (where Bambu Studio provides them) a display label and description. search narrows " +
        "results by a case-insensitive substring match against the key, label, and description. Results feed " +
        "the kvps argument of the write_<kind>_profile tools.\n\n" +
        "Args:\n  - kind (\"process\" | \"filament\"): which schema to list\n" +
        "  - search (string, optional): case-insensitive substring filter on key, label, or description\n\n" +
        "Returns: { kind, parameters: [{ key, type, vector, enum?, min?, max?, default?, label?, description? }] }\n\n" +
        "Errors: config missing (fix via init_config).",
      inputSchema: {
        kind: kindEnum.describe("Which schema to list"),
        search: z.string().min(1).optional().describe("Case-insensitive substring filter on key, label, or description"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; search?: string }) => {
      try {
        const result = await handleListParameters(deps, args);
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

function registerListFilaments(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_filaments",
    {
      title: "List filaments",
      description:
        "List the distinct filament ids with their display names across all filament profiles (the " +
        "configured user store plus every vendor's system filament directory). Only profiles that carry a " +
        "filament_id contribute an entry.\n\n" +
        "Returns: { filaments: [{ id, name }] } (sorted by id, deduplicated)\n\n" +
        "Errors: config missing (fix via init_config).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = await handleListFilaments(deps);
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
  registerListProfiles(server, deps);
  registerListVendors(server, deps);
  registerListParameters(server, deps);
  registerListFilaments(server, deps);
}
