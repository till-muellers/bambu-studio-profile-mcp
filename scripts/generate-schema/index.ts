#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>
 * Writes schema/process.schema.json and schema/filament.schema.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileSchema } from "../../src/types.js";
import {
  applyDescriptions,
  parseOptionList,
  parsePrintConfig,
  parseStringVector,
  synthesizeFilamentOverrides,
} from "./parse.js";

const checkout = process.argv[2];
if (!checkout) {
  console.error("Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>");
  process.exit(1);
}

const printConfigPath = join(checkout, "src", "libslic3r", "PrintConfig.cpp");
if (!existsSync(printConfigPath)) {
  console.error(`Not a BambuStudio checkout: '${printConfigPath}' not found.`);
  process.exit(1);
}

const presetCandidates = [
  join(checkout, "src", "slic3r", "GUI", "Preset.cpp"),
  join(checkout, "src", "libslic3r", "Preset.cpp"),
];
const presetPath = presetCandidates.find((p) => existsSync(p));
if (!presetPath) {
  console.error(`Preset.cpp not found in: ${presetCandidates.join(", ")}`);
  process.exit(1);
}

const printConfigSource = await readFile(printConfigPath, "utf8");
const allOptions = parsePrintConfig(printConfigSource);
synthesizeFilamentOverrides(
  allOptions,
  parseStringVector(printConfigSource, "filament_extruder_override_keys"),
  parseStringVector(printConfigSource, "filament_overhang_override_keys")
);
const presetSource = await readFile(presetPath, "utf8");
const processKeys = new Set(parseOptionList(presetSource, "print_options"));
const filamentKeys = new Set(parseOptionList(presetSource, "filament_options"));

function pick(keys: Set<string>): ProfileSchema {
  const out: ProfileSchema = {};
  for (const [key, option] of Object.entries(allOptions)) {
    if (keys.has(key)) out[key] = option;
  }
  return out;
}

const processSchema = pick(processKeys);
const filamentSchema = pick(filamentKeys);
if (Object.keys(processSchema).length === 0 || Object.keys(filamentSchema).length === 0) {
  console.error(
    `Parsed ${Object.keys(allOptions).length} options but matched ` +
      `${Object.keys(processSchema).length} process / ${Object.keys(filamentSchema).length} filament keys. ` +
      `The option-list parsing likely needs adjusting for this checkout — inspect ${presetPath}.`
  );
  process.exit(1);
}

const descriptionsPath = join("schema", "descriptions.json");
let descriptions: Record<string, string>;
try {
  descriptions = JSON.parse(await readFile(descriptionsPath, "utf8"));
} catch (err) {
  console.error(
    `Failed to load description overlay at '${descriptionsPath}': ${(err as Error).message}`
  );
  process.exit(1);
}

const processReport = applyDescriptions(processSchema, descriptions);
const filamentReport = applyDescriptions(filamentSchema, descriptions);

await mkdir("schema", { recursive: true });
await writeFile(join("schema", "process.schema.json"), JSON.stringify(processSchema, null, 2) + "\n");
await writeFile(join("schema", "filament.schema.json"), JSON.stringify(filamentSchema, null, 2) + "\n");
console.log(
  `Wrote schema/process.schema.json (${Object.keys(processSchema).length} keys) and ` +
    `schema/filament.schema.json (${Object.keys(filamentSchema).length} keys).`
);

function reportOverlay(kind: string, schema: ProfileSchema, report: { applied: number; missing: string[] }): void {
  console.error(
    `${kind}: applied ${report.applied}/${Object.keys(schema).length} descriptions, ${report.missing.length} missing.`
  );
  if (report.missing.length > 0) {
    console.error(`${kind} missing keys: ${report.missing.join(", ")}`);
  }
}

reportOverlay("process", processSchema, processReport);
reportOverlay("filament", filamentSchema, filamentReport);

// A key is only truly stale if it matches neither kind's options — reporting per-kind stale
// against the same flat overlay would flag every filament-only key as "stale" in the process run
// (and vice versa), which is permanently noisy once the overlay covers both kinds.
const knownKeys = new Set([...Object.keys(processSchema), ...Object.keys(filamentSchema)]);
const globalStale = Object.keys(descriptions).filter((key) => !knownKeys.has(key));
if (globalStale.length > 0) {
  console.error(`stale overlay keys (no matching option in either kind): ${globalStale.join(", ")}`);
}
