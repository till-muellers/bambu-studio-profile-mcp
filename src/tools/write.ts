import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { writeProfileFile } from "../profile-store.js";
import { resolveProfile } from "../resolver.js";
import type { ProfileKind } from "../types.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface WriteResult {
  vendor: string;
  name: string;
  kind: ProfileKind;
  created: boolean;
  path: string;
  inherits: string;
  overrides: Record<string, unknown>;
}

export async function handleWrite(
  deps: ToolDeps,
  kind: ProfileKind,
  args: {
    vendor: string;
    name: string;
    baseProfile: string;
    kvps: Record<string, unknown>;
    outputDir: string;
  }
): Promise<WriteResult> {
  const cfg = await deps.config.require();
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const reservedKeys = (["inherits", "name"] as const).filter((key) => key in args.kvps);
  const reservedViolations = reservedKeys.map((key) => ({
    key,
    reason: "reserved key: set via the 'name'/'baseProfile' argument, not kvps",
  }));
  const kvpsToValidate = Object.fromEntries(
    Object.entries(args.kvps).filter(([key]) => !reservedKeys.includes(key as "inherits" | "name"))
  );
  const violations = [...reservedViolations, ...validateKvps(schema, kvpsToValidate)];
  if (violations.length > 0) throw new SchemaValidationError(violations);

  const store = deps.storeFactory(cfg);
  await resolveProfile(store, kind, args.vendor, args.baseProfile);

  const body = { name: args.name, inherits: args.baseProfile, ...args.kvps };
  const { path, created } = await writeProfileFile(args.outputDir, args.name, body);
  return {
    vendor: args.vendor,
    name: args.name,
    kind,
    created,
    path,
    inherits: args.baseProfile,
    overrides: args.kvps,
  };
}

const writeInputShape = {
  kind: z.enum(["process", "filament"]).describe("Profile type to create"),
  vendor: z
    .string()
    .min(1)
    .describe("Vendor id from list_vendors, e.g. 'BBL'; names the system store baseProfile is resolved against"),
  name: z.string().min(1).describe("Name of the profile to create; also the output filename (<name>.json)"),
  baseProfile: z
    .string()
    .min(1)
    .describe("Exact name of the existing profile to inherit from, as returned by list_profiles"),
  kvps: z
    .record(z.unknown())
    .describe(
      "Object mapping option key to value, validated against schema/<kind>.schema.json. Scalar options " +
        "take a single string like \"0.2\" or \"100%\"; vector (per-extruder) options take a string array " +
        "like [\"200\",\"500\",\"500\"] — any length from 1 up is accepted, so a single-element array " +
        "like [\"230\"] is fine. Example: " +
        "{\"layer_height\": \"0.16\", \"outer_wall_speed\": [\"150\",\"400\",\"400\"]}. " +
        "'name' and 'inherits' are reserved, set via the name/baseProfile arguments instead."
    ),
  outputDir: z.string().min(1).describe("Directory the profile file is written to; created if missing"),
};

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "write_profile",
    {
      title: "Write profile",
      description:
        "Create a Bambu Studio process or filament profile file: writes <outputDir>/<name>.json, " +
        "inheriting from baseProfile and containing only the kvps overrides. Overwrites the file when it " +
        "already exists; Bambu Studio's own directories stay untouched. Every kvps key and value is " +
        "validated against the option schema before anything is written; all violations are reported " +
        "together.\n\n" +
        "Returns: { vendor, name, kind, created (false when an existing file was overwritten), path, " +
        "inherits, overrides }\n\n" +
        "Errors: baseProfile not found or unresolvable; schema violations listed per key; config " +
        "missing (run init_config first).\n\n" +
        "Typical flow to extend an existing profile: find it with list_profiles, inspect its effective " +
        "settings with resolve_profile, look up valid option keys and value ranges with list_parameters, " +
        "then call write_profile with only the changed keys as kvps.",
      inputSchema: writeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      kind: ProfileKind;
      vendor: string;
      name: string;
      baseProfile: string;
      kvps: Record<string, unknown>;
      outputDir: string;
    }) => {
      try {
        const result = await handleWrite(deps, args.kind, args);
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
