#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/generate-schema/index.ts <path-to-BambuStudio-checkout>
 * Writes schema/process.schema.json and schema/filament.schema.json.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileSchema } from "../../src/types.js";
import { parseOptionList, parsePrintConfig } from "./parse.js";

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

const allOptions = parsePrintConfig(await readFile(printConfigPath, "utf8"));
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

await mkdir("schema", { recursive: true });
await writeFile(join("schema", "process.schema.json"), JSON.stringify(processSchema, null, 2) + "\n");
await writeFile(join("schema", "filament.schema.json"), JSON.stringify(filamentSchema, null, 2) + "\n");
console.log(
  `Wrote schema/process.schema.json (${Object.keys(processSchema).length} keys) and ` +
    `schema/filament.schema.json (${Object.keys(filamentSchema).length} keys).`
);
