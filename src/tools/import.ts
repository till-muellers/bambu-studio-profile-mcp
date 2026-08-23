import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { resolveProfile } from "../resolver.js";
import { strings } from "../strings.js";
import type { ProfileKind, RawProfile } from "../types.js";
import {
  STUDIO_RESTART_NOTE,
  formatInfoSidecar,
  parseSettingId,
  userPresetPaths,
} from "../user-presets.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface ImportResult {
  kind: ProfileKind;
  name: string;
  path: string;
  infoPath: string;
  overwritten: boolean;
  note: string;
}

export async function handleImport(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; outputDir: string; name: string; overwrite?: boolean }
): Promise<ImportResult> {
  const cfg = await deps.config.require();

  const sourcePath = join(args.outputDir, `${args.name}.json`);
  if (!existsSync(sourcePath)) {
    throw new Error(strings.messages.importSourceNotFound(sourcePath));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch {
    throw new Error(strings.messages.importSourceNotJson(sourcePath));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(strings.messages.importSourceNotObject(sourcePath));
  }
  const source = parsed as RawProfile;
  if (typeof source.inherits !== "string" || source.inherits === "") {
    throw new Error(strings.messages.importSourceMissingInherits(sourcePath));
  }

  const kvps = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "name" && key !== "inherits")
  );
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const violations = validateKvps(schema, kvps);
  if (violations.length > 0) throw new SchemaValidationError(violations);

  const store = deps.storeFactory(cfg);
  const resolvedBase = await resolveProfile(store, kind, args.vendor, source.inherits);

  const { jsonPath, infoPath } = userPresetPaths(cfg, kind, args.name);
  const overwritten = existsSync(jsonPath);
  if (overwritten) {
    if (!args.overwrite) {
      throw new Error(strings.messages.importTargetExists(jsonPath));
    }
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch {
      throw new Error(strings.messages.importTargetUnparseable(jsonPath));
    }
    if ((existing as RawProfile).from !== "User") {
      throw new Error(strings.messages.importTargetNotUser(jsonPath));
    }
  }

  const version = resolvedBase.settings.version;
  const body: Record<string, unknown> = {
    name: args.name,
    inherits: source.inherits,
    from: "User",
    ...(typeof version === "string" ? { version } : {}),
    ...(kind === "process"
      ? { print_settings_id: args.name }
      : { filament_settings_id: [args.name] }),
    ...kvps,
  };
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(body, null, 4) + "\n", "utf8");
  await writeFile(infoPath, formatInfoSidecar(Math.floor(Date.now() / 1000)), "utf8");

  return { kind, name: args.name, path: jsonPath, infoPath, overwritten, note: STUDIO_RESTART_NOTE };
}

export interface RemoveResult {
  kind: ProfileKind;
  name: string;
  removedJson: string;
  removedInfo: string | null;
  cloudRecord: boolean;
  note: string;
}

export async function handleRemove(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { name: string }
): Promise<RemoveResult> {
  const cfg = await deps.config.require();
  const { jsonPath, infoPath } = userPresetPaths(cfg, kind, args.name);
  const infoExists = existsSync(infoPath);

  if (!existsSync(jsonPath)) {
    if (infoExists) {
      throw new Error(strings.messages.removeStraySidecar(jsonPath, infoPath));
    }
    throw new Error(strings.messages.removeNotFound(jsonPath));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    throw new Error(strings.messages.removeUnparseable(jsonPath));
  }
  if ((parsed as RawProfile).from !== "User") {
    throw new Error(strings.messages.removeNotUser(jsonPath));
  }

  let cloudRecord = false;
  if (infoExists) {
    cloudRecord = parseSettingId(await readFile(infoPath, "utf8")) !== "";
  }

  await rm(jsonPath);
  if (infoExists) await rm(infoPath);

  const note = cloudRecord
    ? `${STUDIO_RESTART_NOTE} ${strings.messages.cloudRecordWarning}`
    : STUDIO_RESTART_NOTE;
  return {
    kind,
    name: args.name,
    removedJson: jsonPath,
    removedInfo: infoExists ? infoPath : null,
    cloudRecord,
    note,
  };
}

const removeInputShape = {
  kind: z.enum(["process", "filament"]).describe(strings.tools.removeProfile.inputs.kind),
  name: z.string().min(1).describe(strings.tools.removeProfile.inputs.name),
};

function registerRemoveProfile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "remove_profile",
    {
      title: strings.tools.removeProfile.title,
      description: strings.tools.removeProfile.description,
      inputSchema: removeInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; name: string }) => {
      try {
        const result = await handleRemove(deps, args.kind, args);
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

const importInputShape = {
  kind: z.enum(["process", "filament"]).describe(strings.tools.importProfile.inputs.kind),
  vendor: z.string().min(1).describe(strings.tools.importProfile.inputs.vendor),
  outputDir: z.string().min(1).describe(strings.tools.importProfile.inputs.outputDir),
  name: z.string().min(1).describe(strings.tools.importProfile.inputs.name),
  overwrite: z.boolean().optional().describe(strings.tools.importProfile.inputs.overwrite),
};

export function registerImportTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "import_profile",
    {
      title: strings.tools.importProfile.title,
      description: strings.tools.importProfile.description,
      inputSchema: importInputShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; vendor: string; outputDir: string; name: string; overwrite?: boolean }) => {
      try {
        const result = await handleImport(deps, args.kind, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
  registerRemoveProfile(server, deps);
}
