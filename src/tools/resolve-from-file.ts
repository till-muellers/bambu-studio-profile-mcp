import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { PROFILE_FILE_MESSAGES, readInheritingProfileFile } from "../profile-file.js";
import { loadChain, mergeChain } from "../resolver.js";
import { strings } from "../strings.js";
import type { ReadableProfileKind, RawProfile, ResolvedProfile } from "../types.js";
import { CONTENT_SKIP_KEYS, omitKeys } from "../user-presets.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { nilResolutionOptions } from "./nil-options.js";
import { projectResolved } from "./project-keys.js";

export interface ResolvedFileProfile extends ResolvedProfile {
  /** The file the overrides were read from. */
  path: string;
}

export async function handleResolveFromFile(
  deps: ToolDeps,
  kind: ReadableProfileKind,
  args: {
    vendor: string;
    outputDir: string;
    name: string;
    sourceName?: string;
    keys?: string[];
    machineName?: string;
  }
): Promise<ResolvedFileProfile> {
  const cfg = await deps.config.require();
  const path = join(args.outputDir, `${args.sourceName ?? args.name}.json`);

  const source = await readInheritingProfileFile(path, PROFILE_FILE_MESSAGES);

  const store = deps.storeFactory(cfg);
  const options = await nilResolutionOptions(deps, store, kind, args.vendor, args.machineName);
  const baseChain = await loadChain(store, kind, args.vendor, source.inherits);
  const fileLayer: RawProfile = { name: args.name, ...omitKeys(source, CONTENT_SKIP_KEYS) };

  const result: ResolvedFileProfile = {
    vendor: args.vendor,
    name: args.name,
    kind,
    chain: [...baseChain.map((p) => p.name), args.name],
    path,
    ...mergeChain([...baseChain, fileLayer], options),
  };
  if (args.keys === undefined) return result;
  return projectResolved(result, args.keys);
}

const resolveFromFileInputShape = {
  kind: z.enum(["process", "filament", "machine"]).describe(strings.tools.resolveFromFile.inputs.kind),
  vendor: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.vendor),
  outputDir: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.outputDir),
  name: z.string().min(1).describe(strings.tools.resolveFromFile.inputs.name),
  sourceName: z.string().min(1).optional().describe(strings.tools.resolveFromFile.inputs.sourceName),
  keys: z.array(z.string().min(1)).min(1).optional().describe(strings.tools.resolveFromFile.inputs.keys),
  machineName: z.string().min(1).optional().describe(strings.tools.resolveFromFile.inputs.machineName),
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
      kind: ReadableProfileKind;
      vendor: string;
      outputDir: string;
      name: string;
      sourceName?: string;
      keys?: string[];
      machineName?: string;
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
