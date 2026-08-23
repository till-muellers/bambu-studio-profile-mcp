import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SchemaValidationError } from "../errors.js";
import { resolveProfile } from "../resolver.js";
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
    throw new Error(`Source profile '${sourcePath}' not found. Create it with write_profile first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch {
    throw new Error(`Source profile '${sourcePath}' is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Source profile '${sourcePath}' does not contain a JSON object.`);
  }
  const source = parsed as RawProfile;
  if (typeof source.inherits !== "string" || source.inherits === "") {
    throw new Error(`Source profile '${sourcePath}' has no 'inherits' field.`);
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
      throw new Error(`Target preset '${jsonPath}' already exists. Pass overwrite: true to replace it.`);
    }
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch {
      throw new Error(
        `Refusing to overwrite '${jsonPath}': cannot verify it is a user preset (unparseable JSON).`
      );
    }
    if ((existing as RawProfile).from !== "User") {
      throw new Error(`Refusing to overwrite '${jsonPath}': its 'from' field is not "User".`);
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
      throw new Error(
        `Preset JSON '${jsonPath}' is missing but a stray sidecar '${infoPath}' exists; nothing was removed.`
      );
    }
    throw new Error(`Preset '${jsonPath}' not found in the user store.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    throw new Error(`Refusing to remove '${jsonPath}': cannot verify it is a user preset (unparseable JSON).`);
  }
  if ((parsed as RawProfile).from !== "User") {
    throw new Error(`Refusing to remove '${jsonPath}': its 'from' field is not "User".`);
  }

  let cloudRecord = false;
  if (infoExists) {
    cloudRecord = parseSettingId(await readFile(infoPath, "utf8")) !== "";
  }

  await rm(jsonPath);
  if (infoExists) await rm(infoPath);

  const note = cloudRecord
    ? `${STUDIO_RESTART_NOTE} A cloud record exists for this preset; Bambu Studio's sync may restore it.`
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
  kind: z.enum(["process", "filament"]).describe("Profile type to remove"),
  name: z.string().min(1).describe("Name of the user preset to remove from user/<userId>/<kind>/"),
};

function registerRemoveProfile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "remove_profile",
    {
      title: "Remove profile",
      description:
        "Delete a user preset (its JSON plus .info sidecar) from Bambu Studio's user preset store " +
        "(user/<userId>/<kind>/). Only presets whose own 'from' field is \"User\" are removable. " +
        "When the preset has a cloud record (populated setting_id in its sidecar) it is still " +
        "removed locally and the result flags cloudRecord: true, since Bambu Studio's sync may " +
        "restore it.\n\n" +
        "Returns: { kind, name, removedJson, removedInfo, cloudRecord, note } — removedInfo is null " +
        "when no sidecar existed; note states that Bambu Studio sees the change after a restart.\n\n" +
        "Errors: preset not found; a stray sidecar without its JSON; the preset's 'from' is not " +
        "\"User\" or its JSON is unparseable (refused regardless of flags); config missing (run " +
        "init_config first).\n\n" +
        "Discover installed user presets with list_profiles (source \"user\").",
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
  kind: z.enum(["process", "filament"]).describe("Profile type to import"),
  vendor: z
    .string()
    .min(1)
    .describe("Vendor id from list_vendors, e.g. 'BBL'; names the system store the source's inherits chain is resolved against"),
  outputDir: z.string().min(1).describe("Directory containing the source file written by write_profile"),
  name: z.string().min(1).describe("Name of the profile to import; locates <outputDir>/<name>.json and names the installed preset"),
  overwrite: z
    .boolean()
    .optional()
    .describe("Pass true to replace an existing user preset of the same name; defaults to false"),
};

export function registerImportTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "import_profile",
    {
      title: "Import profile",
      description:
        "Install a profile file written by write_profile into Bambu Studio's user preset store " +
        "(user/<userId>/<kind>/), synthesizing the metadata Bambu Studio expects (from, version, " +
        "settings id) and a minimal .info sidecar. The source is fully re-validated against the " +
        "option schema first and its inherits chain is resolved; nothing is installed when any " +
        "check fails. Replacing an existing preset requires overwrite: true and only ever replaces " +
        "presets whose own 'from' field is \"User\".\n\n" +
        "Returns: { kind, name, path, infoPath, overwritten, note } — note states that Bambu Studio " +
        "sees the preset after a restart.\n\n" +
        "Errors: source missing or unparseable; schema violations listed per key; vendor or inherits " +
        "target not found; target exists without overwrite; target's 'from' is not \"User\" (refused " +
        "regardless of flags); config missing (run init_config first).\n\n" +
        "Typical flow: write_profile into an outputDir, then import_profile with the same " +
        "outputDir/name. Remove an installed preset again with remove_profile.",
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
