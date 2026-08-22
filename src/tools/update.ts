import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { writeProfileFile } from "../profile-store.js";
import type { ProfileKind, RawProfile, Violation } from "../types.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface UpdateResult {
  name: string;
  kind: ProfileKind;
  path: string;
  set: string[];
  removed: string[];
  overrides: Record<string, unknown>;
}

const RESERVED_KEYS = ["name", "inherits"] as const;

export async function handleUpdate(
  deps: ToolDeps,
  kind: ProfileKind,
  args: {
    name: string;
    outputDir: string;
    set?: Record<string, unknown>;
    remove?: string[];
  }
): Promise<UpdateResult> {
  await deps.config.require();

  const set = args.set ?? {};
  const remove = args.remove ?? [];
  if (Object.keys(set).length === 0 && remove.length === 0) {
    throw new Error("Nothing to do: pass set and/or remove.");
  }

  const path = join(args.outputDir, `${args.name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Profile file '${path}' not found. write_profile creates profiles.`);
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Profile file '${path}' could not be read. write_profile creates profiles.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Profile file '${path}' is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Profile file '${path}' does not contain a JSON object.`);
  }
  const body = parsed as RawProfile;

  const violations: Violation[] = [];

  const reservedInSet = RESERVED_KEYS.filter((key) => key in set);
  const reservedInRemove = RESERVED_KEYS.filter((key) => remove.includes(key));
  for (const key of [...reservedInSet, ...reservedInRemove]) {
    violations.push({ key, reason: "reserved key: managed via write_profile's name/baseProfile arguments" });
  }

  const setToValidate = Object.fromEntries(
    Object.entries(set).filter(([key]) => !reservedInSet.includes(key as (typeof RESERVED_KEYS)[number]))
  );
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  violations.push(...validateKvps(schema, setToValidate));

  const removeToCheck = remove.filter((key) => !reservedInRemove.includes(key as (typeof RESERVED_KEYS)[number]));
  for (const key of removeToCheck) {
    if (!(key in body) || key === "name" || key === "inherits") {
      violations.push({ key, reason: "key not present in the profile file" });
    }
  }

  if (violations.length > 0) throw new SchemaValidationError(violations);

  const nextBody: Record<string, unknown> = { ...body };
  for (const key of remove) delete nextBody[key];
  for (const [key, value] of Object.entries(set)) nextBody[key] = value;

  const { path: writtenPath } = await writeProfileFile(args.outputDir, args.name, nextBody);

  const overrides = Object.fromEntries(Object.entries(nextBody).filter(([key]) => key !== "name" && key !== "inherits"));

  return {
    name: args.name,
    kind,
    path: writtenPath,
    set: Object.keys(set),
    removed: remove,
    overrides,
  };
}

const updateInputShape = {
  kind: z.enum(["process", "filament"]).describe("Profile type; selects the validation schema"),
  name: z.string().min(1).describe("Name of the existing profile file, <name>.json in outputDir"),
  outputDir: z.string().min(1).describe("Directory containing the profile file"),
  set: z
    .record(z.unknown())
    .optional()
    .describe(
      "Object mapping option key to value, validated against schema/<kind>.schema.json. Scalar options " +
        "take a single string like \"0.2\" or \"100%\"; vector (per-extruder) options take a string array " +
        "with one element per position of the base profile's variant list. \"nil\" as an element keeps the " +
        "base value at that position and is valid only on options list_parameters marks nullable: true. " +
        "Existing keys are overwritten, new keys are added. 'name' and 'inherits' are reserved."
    ),
  remove: z
    .array(z.string().min(1))
    .optional()
    .describe("Override keys to delete from the file; each key must already exist in the file."),
};

export function registerUpdateTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "update_profile",
    {
      title: "Update profile",
      description:
        "Incrementally edit a profile file previously created by write_profile: upsert the `set` keys and " +
        "delete the `remove` keys in one atomic, validated step. Keys not mentioned stay unchanged. The " +
        "file's name and inherits stay as they are.\n\n" +
        "Returns: { name, kind, path, set (applied set keys), removed (applied remove keys), overrides " +
        "(the file's final key->value map excluding name/inherits) }\n\n" +
        "Errors: file not found in outputDir (create it with write_profile first); schema violations, " +
        "reserved keys in set/remove, and unknown remove keys are all listed together; nothing to do when " +
        "both set and remove are omitted; config missing (run init_config first).\n\n" +
        "write_profile replaces a file wholesale; update_profile is the tool for incremental changes.",
      inputSchema: updateInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      kind: ProfileKind;
      name: string;
      outputDir: string;
      set?: Record<string, unknown>;
      remove?: string[];
    }) => {
      try {
        const result = await handleUpdate(deps, args.kind, args);
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
