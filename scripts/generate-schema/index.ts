#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>
 * Writes schema/process.schema.json, schema/filament.schema.json and schema/machine.schema.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileSchema } from "../../src/types.js";
import {
  applyDescriptions,
  parseAxisLimitOptions,
  parseExtruderOptionKeys,
  parseOptionList,
  parsePrintConfig,
  parsePrinterOptionList,
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
const allOptions = { ...parsePrintConfig(printConfigSource), ...parseAxisLimitOptions(printConfigSource) };
synthesizeFilamentOverrides(
  allOptions,
  parseStringVector(printConfigSource, "filament_extruder_override_keys"),
  parseStringVector(printConfigSource, "filament_overhang_override_keys")
);
const presetSource = await readFile(presetPath, "utf8");
const processKeys = new Set(parseOptionList(presetSource, "print_options"));
const filamentKeys = new Set(parseOptionList(presetSource, "filament_options"));

/** Identity and metadata fields of a machine preset file; they are not schema options. */
const MACHINE_METADATA_KEYS = new Set([
  "name",
  "from",
  "version",
  "inherits",
  "instantiation",
  "setting_id",
  "printer_settings_id",
  "type",
  "printer_model",
  "printer_variant",
]);

// `Preset::printer_options()` = s_Preset_printer_options + s_Preset_machine_limits_options +
// Preset::nozzle_options(), the last being print_config_def.extruder_option_keys().
const machineKeys = new Set([
  ...parsePrinterOptionList(presetSource),
  ...parseExtruderOptionKeys(printConfigSource),
]);

function pick(keys: Set<string>): ProfileSchema {
  const out: ProfileSchema = {};
  for (const [key, option] of Object.entries(allOptions)) {
    if (keys.has(key)) out[key] = option;
  }
  return out;
}

const processSchema = pick(processKeys);
const filamentSchema = pick(filamentKeys);
const machineSchema = pick(machineKeys);
if (
  Object.keys(processSchema).length === 0 ||
  Object.keys(filamentSchema).length === 0 ||
  Object.keys(machineSchema).length === 0
) {
  console.error(
    `Parsed ${Object.keys(allOptions).length} options but matched ` +
      `${Object.keys(processSchema).length} process / ${Object.keys(filamentSchema).length} filament / ` +
      `${Object.keys(machineSchema).length} machine keys. ` +
      `The option-list parsing likely needs adjusting for this checkout — inspect ${presetPath}.`
  );
  process.exit(1);
}

// Completeness gate: every non-metadata key any shipped BBL machine preset actually sets must be
// in the emitted machine schema. This is what surfaces the runtime-only nozzle_options() keys.
const machineProfileDir = join(checkout, "resources", "profiles", "BBL", "machine");
const observedMachineKeys = new Set<string>();
for (const entry of await readdir(machineProfileDir)) {
  if (!entry.endsWith(".json")) continue;
  let preset: Record<string, unknown>;
  try {
    preset = JSON.parse(await readFile(join(machineProfileDir, entry), "utf8"));
  } catch (err) {
    console.error(`Failed to parse machine preset '${entry}': ${(err as Error).message}`);
    process.exit(1);
  }
  // The directory also holds `machine_model` descriptors and untyped g-code template fragments;
  // neither carries machine option keys.
  if (preset.type !== "machine") continue;
  for (const key of Object.keys(preset)) {
    if (!MACHINE_METADATA_KEYS.has(key)) observedMachineKeys.add(key);
  }
}
const uncoveredMachineKeys = [...observedMachineKeys].filter((key) => !(key in machineSchema)).sort();
// A key PrintConfig.cpp never defines is not an option in this Studio version — the shipped vendor
// profiles carry it as file-level data or as a leftover. Only an option the generator *could* have
// emitted and did not is a gate failure.
const undefinedInPrintConfig = uncoveredMachineKeys.filter((key) => !(key in allOptions));
const droppedOptions = uncoveredMachineKeys.filter((key) => key in allOptions);
if (undefinedInPrintConfig.length > 0) {
  console.error(
    `machine: ${undefinedInPrintConfig.length} key(s) set by shipped BBL machine presets have no ` +
      `option definition in PrintConfig.cpp and are therefore absent from the schema: ` +
      `${undefinedInPrintConfig.join(", ")}`
  );
}
if (droppedOptions.length > 0) {
  console.error(
    `Machine schema is incomplete: ${droppedOptions.length} key(s) set by shipped BBL machine ` +
      `presets are defined in PrintConfig.cpp but absent from the emitted schema: ` +
      `${droppedOptions.join(", ")}`
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
const machineReport = applyDescriptions(machineSchema, descriptions);

await mkdir("schema", { recursive: true });
await writeFile(join("schema", "process.schema.json"), JSON.stringify(processSchema, null, 2) + "\n");
await writeFile(join("schema", "filament.schema.json"), JSON.stringify(filamentSchema, null, 2) + "\n");
await writeFile(join("schema", "machine.schema.json"), JSON.stringify(machineSchema, null, 2) + "\n");
console.log(
  `Wrote schema/process.schema.json (${Object.keys(processSchema).length} keys), ` +
    `schema/filament.schema.json (${Object.keys(filamentSchema).length} keys), and ` +
    `schema/machine.schema.json (${Object.keys(machineSchema).length} keys).`
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
reportOverlay("machine", machineSchema, machineReport);

// A key is only truly stale if it matches neither kind's options — reporting per-kind stale
// against the same flat overlay would flag every filament-only key as "stale" in the process run
// (and vice versa), which is permanently noisy once the overlay covers both kinds.
const knownKeys = new Set([
  ...Object.keys(processSchema),
  ...Object.keys(filamentSchema),
  ...Object.keys(machineSchema),
]);
const globalStale = Object.keys(descriptions).filter((key) => !knownKeys.has(key));
if (globalStale.length > 0) {
  console.error(`stale overlay keys (no matching option in either kind): ${globalStale.join(", ")}`);
}
