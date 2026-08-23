import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { strings } from "../strings.js";
import type { ProfileKind, RawProfile } from "../types.js";
import { userPresetPaths } from "../user-presets.js";
import { toToolError, type ToolDeps } from "./deps.js";

const SKIPPED_KEYS = new Set(["name", "from", "version", "print_settings_id", "filament_settings_id"]);

export interface DiffFileInfo {
  path: string;
  modifiedAt: string;
}

export interface DiffResult {
  kind: ProfileKind;
  name: string;
  identical: boolean;
  changed: { key: string; source: unknown; installed: unknown }[];
  onlyInSource: { key: string; value: unknown }[];
  onlyInstalled: { key: string; value: unknown }[];
  source: DiffFileInfo;
  installed: DiffFileInfo;
  newer: "source" | "installed" | "same";
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    return (
      ka.length === kb.length &&
      ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

async function readProfile(
  path: string,
  notFound: (path: string) => string,
  notJson: (path: string) => string
): Promise<RawProfile> {
  if (!existsSync(path)) throw new Error(notFound(path));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(notJson(path));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(notJson(path));
  }
  return parsed as RawProfile;
}

export async function handleDiff(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { name: string; outputDir: string; sourceName?: string }
): Promise<DiffResult> {
  const cfg = await deps.config.require();
  const { jsonPath: installedPath } = userPresetPaths(cfg, kind, args.name);
  const sourcePath = join(args.outputDir, `${args.sourceName ?? args.name}.json`);

  const source = await readProfile(
    sourcePath,
    strings.messages.diffSourceNotFound,
    strings.messages.diffSourceNotJson
  );
  const installed = await readProfile(
    installedPath,
    strings.messages.diffInstalledNotFound,
    strings.messages.diffInstalledNotJson
  );

  const changed: DiffResult["changed"] = [];
  const onlyInSource: DiffResult["onlyInSource"] = [];
  const onlyInstalled: DiffResult["onlyInstalled"] = [];
  const keys = [...new Set([...Object.keys(source), ...Object.keys(installed)])].sort();
  for (const key of keys) {
    if (SKIPPED_KEYS.has(key)) continue;
    const inSource = key in source;
    const inInstalled = key in installed;
    if (inSource && !inInstalled) onlyInSource.push({ key, value: source[key] });
    else if (!inSource && inInstalled) onlyInstalled.push({ key, value: installed[key] });
    else if (!deepEqual(source[key], installed[key])) {
      changed.push({ key, source: source[key], installed: installed[key] });
    }
  }

  const [sourceStat, installedStat] = await Promise.all([stat(sourcePath), stat(installedPath)]);
  const newer =
    sourceStat.mtimeMs > installedStat.mtimeMs
      ? "source"
      : sourceStat.mtimeMs < installedStat.mtimeMs
        ? "installed"
        : "same";

  return {
    kind,
    name: args.name,
    identical: changed.length === 0 && onlyInSource.length === 0 && onlyInstalled.length === 0,
    changed,
    onlyInSource,
    onlyInstalled,
    source: { path: sourcePath, modifiedAt: sourceStat.mtime.toISOString() },
    installed: { path: installedPath, modifiedAt: installedStat.mtime.toISOString() },
    newer,
  };
}

const diffInputShape = {
  kind: z.enum(["process", "filament"]).describe(strings.tools.diffProfile.inputs.kind),
  name: z.string().min(1).describe(strings.tools.diffProfile.inputs.name),
  outputDir: z.string().min(1).describe(strings.tools.diffProfile.inputs.outputDir),
  sourceName: z.string().min(1).optional().describe(strings.tools.diffProfile.inputs.sourceName),
};

export function registerDiffTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "diff_profile",
    {
      title: strings.tools.diffProfile.title,
      description: strings.tools.diffProfile.description,
      inputSchema: diffInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { kind: ProfileKind; name: string; outputDir: string; sourceName?: string }) => {
      try {
        const result = await handleDiff(deps, args.kind, args);
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
