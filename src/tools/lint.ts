import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { z } from "zod";
import { deepEqual } from "../compare-values.js";
import { PROFILE_FILE_MESSAGES, readInheritingProfileFile } from "../profile-file.js";
import { loadChain, mergeChain, NIL, resolveProfile } from "../resolver.js";
import { strings } from "../strings.js";
import type { ProfileSchema, RawProfile, WritableProfileKind } from "../types.js";
import { SYNTHESIZED_METADATA_KEYS } from "../user-presets.js";
import { loadSchema, validateKvps } from "../validator.js";
import { toToolError, type ToolDeps } from "./deps.js";
import { nilResolutionOptions } from "./nil-options.js";

/** Identity plus synthesized metadata. A lint of overrides lints neither the base nor the identity. */
const SKIPPED_KEYS = new Set<string>(["name", "inherits", ...SYNTHESIZED_METADATA_KEYS]);

/** The checks in the order findings are grouped, most structural consequence first. */
const CHECKS = [
  "parent-equal-override",
  "column-count",
  "scalar-vector-mismatch",
  "unknown-key",
  "nil-equals-parent",
] as const;

export type LintCheck = (typeof CHECKS)[number];

export interface LintFinding {
  check: LintCheck;
  key: string;
  detail: string;
}

export interface LintSkipped {
  check: LintCheck;
  reason: string;
}

export interface LintResult {
  kind: WritableProfileKind;
  name: string;
  path: string;
  clean: boolean;
  findings: LintFinding[];
  skipped: LintSkipped[];
}

/** The file's own content keys: identity and synthesized metadata stay out of every check. */
function overrideKeys(source: RawProfile): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (SKIPPED_KEYS.has(key)) continue;
    overrides[key] = value;
  }
  return overrides;
}

/** Every key the file states at the same value the chain already resolves to. */
function parentEqualOverrides(
  overrides: Record<string, unknown>,
  parentSettings: Record<string, unknown>
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(parentSettings, key)) continue;
    if (!deepEqual(value, parentSettings[key])) continue;
    findings.push({
      check: "parent-equal-override",
      key,
      detail: strings.messages.lintParentEqualOverride(parentSettings[key]),
    });
  }
  return findings;
}

/** Values whose array-ness contradicts the schema's vector flag. */
function shapeMismatches(overrides: Record<string, unknown>, schema: ProfileSchema): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const option = schema[key];
    if (!option) continue;
    const isArray = Array.isArray(value);
    if (option.vector === isArray) continue;
    findings.push({
      check: "scalar-vector-mismatch",
      key,
      detail: option.vector
        ? strings.violations.expectedVector(option.type, value)
        : strings.violations.expectedScalar(option.type),
    });
  }
  return findings;
}

/** Vector arrays whose length differs from the printer's column count. */
function columnCounts(
  overrides: Record<string, unknown>,
  schema: ProfileSchema,
  columns: number,
  machineName: string
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const option = schema[key];
    if (!option?.vector || !Array.isArray(value) || value.length === columns) continue;
    findings.push({
      check: "column-count",
      key,
      detail: strings.messages.lintColumnCount(value.length, columns, machineName),
    });
  }
  return findings;
}

function unknownKeys(overrides: Record<string, unknown>, schema: ProfileSchema): LintFinding[] {
  return validateKvps(schema, overrides)
    .filter((violation) => violation.reason === strings.violations.unknownKey)
    .map((violation) => ({ check: "unknown-key" as const, key: violation.key, detail: violation.reason }));
}

/** "nil" columns whose resolved value the file already states at another column of the same key. */
function nilEqualsParent(
  overrides: Record<string, unknown>,
  resolvedSettings: Record<string, unknown>
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const resolved = resolvedSettings[key];
    if (!Array.isArray(value) || !Array.isArray(resolved)) continue;
    value.forEach((element, index) => {
      if (element !== NIL) return;
      const filled = resolved[index];
      if (filled === undefined || filled === NIL) return;
      const statedAt = value.findIndex((other, i) => i !== index && other !== NIL && deepEqual(other, filled));
      if (statedAt === -1) return;
      findings.push({
        check: "nil-equals-parent",
        key,
        detail: strings.messages.lintNilEqualsParent(index, filled, statedAt),
      });
    });
  }
  return findings;
}

/** Groups findings by check in CHECKS order, by key within each check. */
function ordered(findings: LintFinding[]): LintFinding[] {
  return [...findings].sort(
    (a, b) => CHECKS.indexOf(a.check) - CHECKS.indexOf(b.check) || a.key.localeCompare(b.key)
  );
}

export async function handleLint(
  deps: ToolDeps,
  kind: WritableProfileKind,
  args: {
    vendor: string;
    outputDir: string;
    name: string;
    sourceName?: string;
    machineName?: string;
  }
): Promise<LintResult> {
  const cfg = await deps.config.require();
  const path = join(args.outputDir, `${args.sourceName ?? args.name}.json`);
  const source = await readInheritingProfileFile(path, PROFILE_FILE_MESSAGES);
  const overrides = overrideKeys(source);

  const store = deps.storeFactory(cfg);
  const schema = await loadSchema(join(deps.schemaDir, `${kind}.schema.json`));
  const options = await nilResolutionOptions(deps, store, kind, args.vendor, args.machineName);
  const baseChain = await loadChain(store, kind, args.vendor, source.inherits);
  const parent = mergeChain(baseChain, options);
  const resolved = mergeChain([...baseChain, { name: args.name, ...overrides }], options);

  const findings: LintFinding[] = [
    ...parentEqualOverrides(overrides, parent.settings),
    ...unknownKeys(overrides, schema),
    ...nilEqualsParent(overrides, resolved.settings),
  ];
  const mismatches = shapeMismatches(overrides, schema);
  findings.push(...mismatches);

  const skipped: LintSkipped[] = [];
  if (args.machineName === undefined) {
    skipped.push({ check: "column-count", reason: strings.messages.lintColumnCountNeedsMachine });
  } else {
    const machine = await resolveProfile(store, "machine", args.vendor, args.machineName);
    const variant = machine.settings.printer_extruder_variant;
    if (Array.isArray(variant)) {
      // A key whose shape is already wrong has no meaningful column count.
      const shaped = Object.fromEntries(
        Object.entries(overrides).filter(([key]) => !mismatches.some((m) => m.key === key))
      );
      findings.push(...columnCounts(shaped, schema, variant.length, args.machineName));
    } else {
      skipped.push({
        check: "column-count",
        reason: strings.messages.lintColumnCountNoVariant(args.machineName),
      });
    }
  }

  return { kind, name: args.name, path, clean: findings.length === 0, findings: ordered(findings), skipped };
}

const lintInputShape = {
  kind: z.enum(["process", "filament"]).describe(strings.tools.lintProfile.inputs.kind),
  vendor: z.string().min(1).describe(strings.tools.lintProfile.inputs.vendor),
  outputDir: z.string().min(1).describe(strings.tools.lintProfile.inputs.outputDir),
  name: z.string().min(1).describe(strings.tools.lintProfile.inputs.name),
  sourceName: z.string().min(1).optional().describe(strings.tools.lintProfile.inputs.sourceName),
  machineName: z.string().min(1).optional().describe(strings.tools.lintProfile.inputs.machineName),
};

export function registerLintTool(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "lint_profile",
    {
      title: strings.tools.lintProfile.title,
      description: strings.tools.lintProfile.description,
      inputSchema: lintInputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: {
      kind: WritableProfileKind;
      vendor: string;
      outputDir: string;
      name: string;
      sourceName?: string;
      machineName?: string;
    }) => {
      try {
        const result = await handleLint(deps, args.kind, args);
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
