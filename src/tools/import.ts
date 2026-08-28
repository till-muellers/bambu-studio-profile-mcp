import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readAppVersion } from "../config.js";
import { SchemaValidationError } from "../errors.js";
import {
  readInheritingProfileFile,
  type InheritingProfileFileMessages,
} from "../profile-file.js";
import { resolveProfile } from "../resolver.js";
import { strings } from "../strings.js";
import type { WritableProfileKind, RawProfile } from "../types.js";
import {
  CONTENT_SKIP_KEYS,
  STUDIO_RESTART_NOTE,
  formatInfoSidecar,
  omitKeys,
  parseSettingId,
  userPresetPaths,
} from "../user-presets.js";
import { evaluateLoadability, readVendorVersion, FALLBACK_PRESET_VERSION } from "../versions.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";

export interface ImportResult {
  kind: WritableProfileKind;
  name: string;
  path: string;
  infoPath: string;
  overwritten: boolean;
  /** Version written into the preset. */
  version: string;
  /** Where that version came from. */
  versionSource: "vendor" | "fallback";
  /** Metadata keys the installed file carries. */
  metadataWritten: string[];
  note: string;
}

const IMPORT_SOURCE_MESSAGES: InheritingProfileFileMessages = {
  notFound: strings.messages.importSourceNotFound,
  notJson: strings.messages.importSourceNotJson,
  notObject: strings.messages.importSourceNotObject,
  missingInherits: strings.messages.importSourceMissingInherits,
};

export async function handleImport(
  deps: ToolDeps,
  kind: WritableProfileKind,
  args: { vendor: string; outputDir: string; name: string; overwrite?: boolean }
): Promise<ImportResult> {
  const cfg = await deps.config.require();

  const sourcePath = join(args.outputDir, `${args.name}.json`);
  const source = await readInheritingProfileFile(sourcePath, IMPORT_SOURCE_MESSAGES);

  const kvps = omitKeys(source, CONTENT_SKIP_KEYS);
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const violations = validateKvps(schema, kvps);
  if (violations.length > 0) throw new SchemaValidationError(violations);

  const store = deps.storeFactory(cfg);
  await resolveProfile(store, kind, args.vendor, source.inherits);

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

  const vendorVersion = await readVendorVersion(cfg, args.vendor);
  const version = vendorVersion ?? FALLBACK_PRESET_VERSION;
  const versionSource: "vendor" | "fallback" = vendorVersion === undefined ? "fallback" : "vendor";
  const settingsIdKey = kind === "process" ? "print_settings_id" : "filament_settings_id";

  const body: Record<string, unknown> = {
    name: args.name,
    inherits: source.inherits,
    from: "User",
    version,
    ...(kind === "process"
      ? { print_settings_id: args.name }
      : { filament_settings_id: [args.name] }),
    ...kvps,
  };
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(body, null, 4) + "\n", "utf8");
  await writeFile(infoPath, formatInfoSidecar(Math.floor(Date.now() / 1000)), "utf8");

  const written: unknown = JSON.parse(await readFile(jsonPath, "utf8"));
  const loadability = evaluateLoadability(
    (written as RawProfile).version,
    await readAppVersion(cfg.userDataDir)
  );
  if (!loadability.ok) {
    throw new Error(strings.messages.importNotLoadable(jsonPath, loadability.reason ?? ""));
  }

  const metadataWritten = ["from", "version", settingsIdKey];
  const note =
    versionSource === "fallback"
      ? `${strings.messages.importMetadataWritten(metadataWritten)} ` +
        `${strings.messages.importVersionFallback(version, args.vendor)} ${STUDIO_RESTART_NOTE}`
      : `${strings.messages.importMetadataWritten(metadataWritten)} ${STUDIO_RESTART_NOTE}`;
  return {
    kind,
    name: args.name,
    path: jsonPath,
    infoPath,
    overwritten,
    version,
    versionSource,
    metadataWritten,
    note,
  };
}

export interface RemoveResult {
  kind: WritableProfileKind;
  name: string;
  removedJson: string;
  removedInfo: string | null;
  cloudRecord: boolean;
  note: string;
}

export async function handleRemove(
  deps: ToolDeps,
  kind: WritableProfileKind,
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
    async (args: { kind: WritableProfileKind; name: string }) => {
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
    async (args: { kind: WritableProfileKind; vendor: string; outputDir: string; name: string; overwrite?: boolean }) => {
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
