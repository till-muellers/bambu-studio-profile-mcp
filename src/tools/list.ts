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
        "Discover the process or filament profiles available in the user preset store and the vendors' " +
        "system stores.\n\n" +
        "Returns: { kind, profiles: [{ name, source: \"user\"|\"system\", vendor?, inherits? }] } — " +
        "user presets carry no vendor field; inherits names a profile's parent.\n\n" +
        "Errors: vendor not found (only when vendor is given); config missing (run init_config first).\n\n" +
        "Results feed the vendor/name/baseProfile arguments of resolve_profile and write_profile.",
      inputSchema: {
        kind: kindEnum.describe("Profile type to list"),
        vendor: z.string().min(1).optional().describe("Vendor id from list_vendors, e.g. 'BBL'; omit to search every vendor"),
        search: z.string().min(1).optional().describe("Case-insensitive substring filter on the profile name, e.g. 'PETG' or '0.16'"),
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
        "List the profile vendors shipped with Bambu Studio.\n\n" +
        "Returns: { vendors: [{ id, name }] }, sorted by id — id (e.g. 'BBL') is the value the vendor " +
        "arguments of resolve_profile, write_profile, and list_profiles expect; name is the display " +
        "name (e.g. 'Bambulab').\n\n" +
        "Errors: config missing (run init_config first).",
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
        "Discover the option keys valid for process or filament profiles, with their value type, " +
        "range/enum, default, and (where Bambu Studio provides them) the GUI label and description. " +
        "Search by name or by what a setting does — the filter matches key, label, and description.\n\n" +
        "Returns: { kind, parameters: [{ key, type, vector, enum?, min?, max?, default?, label?, " +
        "description? }] } — vector: true means the option takes a string array (one element per " +
        "extruder/filament), vector: false a single value.\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Results feed the kvps argument of write_profile: use key as the kvps key and respect " +
        "type/vector/enum/min/max when choosing the value.",
      inputSchema: {
        kind: kindEnum.describe("Profile type whose option schema to list"),
        search: z
          .string()
          .min(1)
          .optional()
          .describe("Case-insensitive substring matched against key, label, and description, e.g. 'seam' or 'temperature'"),
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
        "List the distinct filament products known to Bambu Studio: every filament_id found across the " +
        "user store and all vendors' filament profiles, with a display name.\n\n" +
        "Returns: { filaments: [{ id, name }] }, sorted by id, deduplicated — id is the product code " +
        "(e.g. 'GFB00'), name the human-readable filament name (e.g. 'Bambu ABS').\n\n" +
        "Errors: config missing (run init_config first).\n\n" +
        "Use it to see which filaments exist, then find their concrete profiles by name via " +
        "list_profiles with kind 'filament'.",
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
