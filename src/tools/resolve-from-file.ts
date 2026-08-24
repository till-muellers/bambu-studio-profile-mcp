import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveProfile } from "../resolver.js";
import { strings } from "../strings.js";
import type { ProfileKind, RawProfile, ResolvedProfile } from "../types.js";
import { SYNTHESIZED_METADATA_KEYS } from "../user-presets.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { projectKeys } from "./project-keys.js";

/** Identity plus synthesized metadata; never part of merged settings. */
const SKIPPED_KEYS = new Set<string>(["name", "inherits", ...SYNTHESIZED_METADATA_KEYS]);

export interface ResolvedFileProfile extends ResolvedProfile {
  /** The file the overrides were read from. */
  path: string;
}

export async function handleResolveFromFile(
  deps: ToolDeps,
  kind: ProfileKind,
  args: { vendor: string; outputDir: string; name: string; sourceName?: string; keys?: string[] }
): Promise<ResolvedFileProfile> {
  const cfg = await deps.config.require();
  const path = join(args.outputDir, `${args.sourceName ?? args.name}.json`);

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
  const source = parsed as RawProfile;
  if (typeof source.inherits !== "string" || source.inherits === "") {
    throw new Error(strings.messages.resolveFileMissingInherits(path));
  }

  const store = deps.storeFactory(cfg);
  const base = await resolveProfile(store, kind, args.vendor, source.inherits);

  const settings: Record<string, unknown> = { ...base.settings };
  for (const [key, value] of Object.entries(source)) {
    if (SKIPPED_KEYS.has(key)) continue;
    settings[key] = value;
  }

  const result: ResolvedFileProfile = {
    vendor: args.vendor,
    name: args.name,
    kind,
    chain: [...base.chain, args.name],
    settings,
    path,
  };
  if (args.keys === undefined) return result;
  const projection = projectKeys(settings, args.keys);
  return { ...result, settings: projection.settings, missingKeys: projection.missingKeys };
}

const resolveFromFileInputShape = {
  kind: z.enum(["process", "filament", "machine"]).describe(strings.tools.resolveFromFile.inputs.kind),
  vendor: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.vendor),
  outputDir: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.outputDir),
  name: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.name),
  sourceName: z.string().min(1).optional().describe(strings.tools.resolveFromFile.inputs.sourceName),
  keys: z.array(z.string().min(1)).min(1).optional().describe(strings.tools.resolveFromFile.inputs.keys),
};

export function registerResolveFromFileTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "resolve_from_file",
    {
      title: strings.tools.resolveFromFile.title,
      description: strings.tools.resolveFromFile.description,
      inputSchema: resolveFromFileInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      kind: ProfileKind;
      vendor: string;
      outputDir: string;
      name: string;
      sourceName?: string;
      keys?: string[];
    }) => {
      try {
        const result = await handleResolveFromFile(deps, args.kind, args);
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
