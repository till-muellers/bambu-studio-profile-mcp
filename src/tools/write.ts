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
  vendor: z.string().min(1).describe("Vendor folder under resources/profiles, e.g. 'BBL'"),
  name: z.string().min(1).describe("Name of the profile to create; also the output filename (<name>.json)"),
  baseProfile: z.string().min(1).describe("Existing profile this profile will inherit from"),
  kvps: z
    .record(z.unknown())
    .describe(
      "A JSON OBJECT mapping option key -> value (NOT an array of pairs) — only the keys to override, " +
        "validated against schema/<kind>.schema.json. Scalar options take a single primitive value, " +
        "string preferred to match Bambu's own serialization (e.g. \"0.2\", \"100%\", \"true\"); bare " +
        "numbers/booleans are also accepted. Vector (per-extruder) options take an array of one or more " +
        "strings (e.g. [\"200\",\"500\",\"500\"]). Example: " +
        "{\"layer_height\": \"0.16\", \"outer_wall_speed\": [\"150\",\"400\",\"400\"]}. " +
        "'name' and 'inherits' are reserved (set via the name/baseProfile arguments) and rejected if present."
    ),
  outputDir: z.string().min(1).describe("Directory the profile file is written to; created if missing"),
};

function register(server: McpServer, deps: ToolDeps, kind: ProfileKind): void {
  server.registerTool(
    `write_${kind}_profile`,
    {
      title: `Write ${kind} profile`,
      description:
        `Create or update a Bambu Studio ${kind} profile file in outputDir (NOT in the Bambu Studio ` +
        `directories — importing into Bambu Studio is a separate, later step). The file inherits from ` +
        `baseProfile and contains ONLY the kvps overrides. Every kvps key and value is validated ` +
        `against schema/${kind}.schema.json before anything is written; all violations are reported together.\n\n` +
        `Args:\n  - vendor (string), name (string), baseProfile (string), outputDir (string)\n` +
        `  - kvps (object): a JSON OBJECT mapping option key -> value (NOT an array of pairs). Scalar ` +
        `options take a single primitive, string preferred to match Bambu's own serialization ` +
        `(e.g. "0.2", "100%", "true"); bare numbers/booleans are also accepted. Vector (per-extruder) ` +
        `options take an array of one or more strings (e.g. ["200","500","500"]). Example: ` +
        `{"layer_height": "0.16", "outer_wall_speed": ["150","400","400"]}. Keys must exist in ` +
        `schema/${kind}.schema.json; 'name' and 'inherits' are reserved (set via the name/baseProfile ` +
        `arguments) and rejected if present. All violations are reported together.\n\n` +
        `Returns: { vendor, name, kind, created, path, inherits, overrides }\n\n` +
        `Errors: baseProfile not found or unresolvable; schema violations listed per key; ` +
        `config missing (fix via init_config).`,
      inputSchema: writeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      vendor: string;
      name: string;
      baseProfile: string;
      kvps: Record<string, unknown>;
      outputDir: string;
    }) => {
      try {
        const result = await handleWrite(deps, kind, args);
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

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  register(server, deps, "process");
  register(server, deps, "filament");
}
