import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { strings } from "../strings.js";
import { writeProfileFile } from "../profile-store.js";
import { resolveProfile } from "../resolver.js";
import type { WritableProfileKind } from "../types.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface WriteResult {
  vendor: string;
  name: string;
  kind: WritableProfileKind;
  created: boolean;
  path: string;
  inherits: string;
  overrides: Record<string, unknown>;
}

export async function handleWrite(
  deps: ToolDeps,
  kind: WritableProfileKind,
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
    reason: strings.violations.reservedKeyWrite,
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
  kind: z.enum(["process", "filament"]).describe(strings.tools.writeProfile.inputs.kind),
  vendor: z
    .string()
    .min(1)
    .describe(strings.tools.writeProfile.inputs.vendor),
  name: z.string().min(1).describe(strings.tools.writeProfile.inputs.name),
  baseProfile: z
    .string()
    .min(1)
    .describe(strings.tools.writeProfile.inputs.baseProfile),
  kvps: z
    .record(z.string(), z.unknown())
    .describe(strings.tools.writeProfile.inputs.kvps),
  outputDir: z.string().min(1).describe(strings.tools.writeProfile.inputs.outputDir),
};

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "write_profile",
    {
      title: strings.tools.writeProfile.title,
      description: strings.tools.writeProfile.description,
      inputSchema: writeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      kind: WritableProfileKind;
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
