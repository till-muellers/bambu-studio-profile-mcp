import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { deepEqual } from "../compare-values.js";
import { ProfileNotFoundError } from "../errors.js";
import { strings } from "../strings.js";
import type { ReadableProfileKind, RawProfile } from "../types.js";
import { SYNTHESIZED_METADATA_KEYS } from "../user-presets.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { handleResolve } from "./resolve.js";
import { handleResolveFromFile } from "./resolve-from-file.js";

/** Identity plus synthesized metadata; 'inherits' stays in, since a different base is a difference. */
const SKIPPED_KEYS = new Set<string>(["name", ...SYNTHESIZED_METADATA_KEYS]);

export type CompareMode = "raw" | "resolved";

/** One side of a comparison: a preset by name, or a profile file in a caller-chosen directory. */
export type CompareEndpoint = { preset: string } | { outputDir: string; name: string };

export interface CompareEndpointInfo {
  label: string;
  /** The file a file endpoint was read from. */
  path?: string;
}

export interface CompareResult {
  mode: CompareMode;
  left: CompareEndpointInfo;
  right: CompareEndpointInfo;
  identical: boolean;
  changed: { key: string; left: unknown; right: unknown }[];
  onlyLeft: { key: string; value: unknown }[];
  onlyRight: { key: string; value: unknown }[];
  /** Present when the compared values still held "nil" columns. */
  note?: string;
}

export interface CompareArgs {
  kind: ReadableProfileKind;
  vendor: string;
  left: CompareEndpoint;
  right: CompareEndpoint;
  mode?: CompareMode;
  machineName?: string;
}

interface LoadedEndpoint {
  info: CompareEndpointInfo;
  values: Record<string, unknown>;
  /** Keys whose vector still carries a "nil" column. */
  nilKeys: string[];
}

function isFileEndpoint(endpoint: CompareEndpoint): endpoint is { outputDir: string; name: string } {
  return "outputDir" in endpoint;
}

function comparableKeys(values: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (SKIPPED_KEYS.has(key)) continue;
    kept[key] = value;
  }
  return kept;
}

async function readProfileFile(path: string): Promise<RawProfile> {
  if (!existsSync(path)) throw new Error(strings.messages.resolveFileNotFound(path));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(strings.messages.resolveFileNotJson(path));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(strings.messages.resolveFileNotObject(path));
  }
  return parsed as RawProfile;
}

/** Reads one endpoint's declared keys, without walking its inherits chain. */
async function loadRaw(
  deps: ToolDeps,
  args: CompareArgs,
  endpoint: CompareEndpoint
): Promise<LoadedEndpoint> {
  if (isFileEndpoint(endpoint)) {
    const path = join(endpoint.outputDir, `${endpoint.name}.json`);
    const profile = await readProfileFile(path);
    return { info: { label: endpoint.name, path }, values: comparableKeys(profile), nilKeys: [] };
  }
  const cfg = await deps.config.require();
  const store = deps.storeFactory(cfg);
  const hit = await store.findProfile(args.kind, args.vendor, endpoint.preset);
  if (!hit) throw new ProfileNotFoundError(args.kind, endpoint.preset);
  return { info: { label: endpoint.preset }, values: comparableKeys(hit.profile), nilKeys: [] };
}

/** Resolves one endpoint's full inherits chain into its active settings. */
async function loadResolved(
  deps: ToolDeps,
  args: CompareArgs,
  endpoint: CompareEndpoint
): Promise<LoadedEndpoint> {
  if (isFileEndpoint(endpoint)) {
    const resolved = await handleResolveFromFile(deps, args.kind, {
      vendor: args.vendor,
      outputDir: endpoint.outputDir,
      name: endpoint.name,
      machineName: args.machineName,
    });
    return {
      info: { label: endpoint.name, path: resolved.path },
      values: comparableKeys(resolved.settings),
      nilKeys: Object.keys(resolved.nilUnresolved ?? {}),
    };
  }
  const resolved = await handleResolve(deps, args.kind, {
    vendor: args.vendor,
    name: endpoint.preset,
    machineName: args.machineName,
  });
  return {
    info: { label: endpoint.preset },
    values: comparableKeys(resolved.settings),
    nilKeys: Object.keys(resolved.nilUnresolved ?? {}),
  };
}

async function loadEndpoint(
  deps: ToolDeps,
  args: CompareArgs,
  endpoint: CompareEndpoint,
  side: "left" | "right",
  mode: CompareMode
): Promise<LoadedEndpoint> {
  try {
    return mode === "raw" ? await loadRaw(deps, args, endpoint) : await loadResolved(deps, args, endpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(strings.messages.compareEndpointFailed(side, message));
  }
}

export async function handleCompare(deps: ToolDeps, args: CompareArgs): Promise<CompareResult> {
  const mode: CompareMode = args.mode ?? "resolved";
  const left = await loadEndpoint(deps, args, args.left, "left", mode);
  const right = await loadEndpoint(deps, args, args.right, "right", mode);

  const changed: CompareResult["changed"] = [];
  const onlyLeft: CompareResult["onlyLeft"] = [];
  const onlyRight: CompareResult["onlyRight"] = [];
  const keys = [...new Set([...Object.keys(left.values), ...Object.keys(right.values)])].sort();
  for (const key of keys) {
    const inLeft = key in left.values;
    const inRight = key in right.values;
    if (inLeft && !inRight) onlyLeft.push({ key, value: left.values[key] });
    else if (!inLeft && inRight) onlyRight.push({ key, value: right.values[key] });
    else if (!deepEqual(left.values[key], right.values[key])) {
      changed.push({ key, left: left.values[key], right: right.values[key] });
    }
  }

  const result: CompareResult = {
    mode,
    left: left.info,
    right: right.info,
    identical: changed.length === 0 && onlyLeft.length === 0 && onlyRight.length === 0,
    changed,
    onlyLeft,
    onlyRight,
  };
  const nilKeys = [...new Set([...left.nilKeys, ...right.nilKeys])].filter((key) => keys.includes(key)).sort();
  if (nilKeys.length > 0) result.note = strings.messages.compareNilVerbatim(nilKeys);
  return result;
}

const endpointShape = z.union([
  z.object({ preset: z.string().min(1).describe(strings.tools.compareProfiles.inputs.preset) }),
  z.object({
    outputDir: z.string().min(1).describe(strings.tools.compareProfiles.inputs.outputDir),
    name: z.string().min(1).describe(strings.tools.compareProfiles.inputs.name),
  }),
]);

const compareInputShape = {
  kind: z.enum(["process", "filament", "machine"]).describe(strings.tools.compareProfiles.inputs.kind),
  vendor: z.string().min(1).describe(strings.tools.compareProfiles.inputs.vendor),
  left: endpointShape.describe(strings.tools.compareProfiles.inputs.left),
  right: endpointShape.describe(strings.tools.compareProfiles.inputs.right),
  mode: z.enum(["raw", "resolved"]).optional().describe(strings.tools.compareProfiles.inputs.mode),
  machineName: z.string().min(1).optional().describe(strings.tools.compareProfiles.inputs.machineName),
};

export function registerCompareTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "compare_profiles",
    {
      title: strings.tools.compareProfiles.title,
      description: strings.tools.compareProfiles.description,
      inputSchema: compareInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: CompareArgs) => {
      try {
        const result = await handleCompare(deps, args);
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
