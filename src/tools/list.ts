import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { strings } from "../strings.js";
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
      title: strings.tools.listProfiles.title,
      description: strings.tools.listProfiles.description,
      inputSchema: {
        kind: kindEnum.describe(strings.tools.listProfiles.inputs.kind),
        vendor: z.string().min(1).optional().describe(strings.tools.listProfiles.inputs.vendor),
        search: z.string().min(1).optional().describe(strings.tools.listProfiles.inputs.search),
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
      title: strings.tools.listVendors.title,
      description: strings.tools.listVendors.description,
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
      title: strings.tools.listParameters.title,
      description: strings.tools.listParameters.description,
      inputSchema: {
        kind: kindEnum.describe(strings.tools.listParameters.inputs.kind),
        search: z
          .string()
          .min(1)
          .optional()
          .describe(strings.tools.listParameters.inputs.search),
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
      title: strings.tools.listFilaments.title,
      description: strings.tools.listFilaments.description,
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
