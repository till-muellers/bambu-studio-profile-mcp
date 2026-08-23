import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { strings } from "../strings.js";
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
    throw new Error(strings.messages.nothingToDo);
  }

  const path = join(args.outputDir, `${args.name}.json`);
  if (!existsSync(path)) {
    throw new Error(strings.messages.sourceNotFound(path));
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(strings.messages.sourceNotReadable(path));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(strings.messages.sourceNotJson(path));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(strings.messages.sourceNotObject(path));
  }
  const body = parsed as RawProfile;

  const violations: Violation[] = [];

  const reservedInSet = RESERVED_KEYS.filter((key) => key in set);
  const reservedInRemove = RESERVED_KEYS.filter((key) => remove.includes(key));
  for (const key of [...reservedInSet, ...reservedInRemove]) {
    violations.push({ key, reason: strings.violations.reservedKeyUpdate });
  }

  const overlapKeys = Object.keys(set).filter(
    (key) => remove.includes(key) && !reservedInSet.includes(key as (typeof RESERVED_KEYS)[number])
  );
  for (const key of overlapKeys) {
    violations.push({ key, reason: strings.violations.bothSetAndRemove });
  }

  const setToValidate = Object.fromEntries(
    Object.entries(set).filter(([key]) => !reservedInSet.includes(key as (typeof RESERVED_KEYS)[number]))
  );
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  violations.push(...validateKvps(schema, setToValidate));

  const removeToCheck = remove.filter((key) => !reservedInRemove.includes(key as (typeof RESERVED_KEYS)[number]));
  for (const key of removeToCheck) {
    if (!(key in body) || key === "name" || key === "inherits") {
      violations.push({ key, reason: strings.violations.keyNotPresent });
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
  kind: z.enum(["process", "filament"]).describe(strings.tools.updateProfile.inputs.kind),
  name: z.string().min(1).describe(strings.tools.updateProfile.inputs.name),
  outputDir: z.string().min(1).describe(strings.tools.updateProfile.inputs.outputDir),
  set: z
    .record(z.unknown())
    .optional()
    .describe(strings.tools.updateProfile.inputs.set),
  remove: z
    .array(z.string().min(1))
    .optional()
    .describe(strings.tools.updateProfile.inputs.remove),
};

export function registerUpdateTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "update_profile",
    {
      title: strings.tools.updateProfile.title,
      description: strings.tools.updateProfile.description,
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
