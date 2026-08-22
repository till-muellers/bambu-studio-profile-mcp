import type { SchemaOption, SchemaType } from "../../src/types.js";

const TYPE_MAP: Record<string, { type: SchemaType; vector: boolean }> = {
  coFloat: { type: "float", vector: false },
  coFloats: { type: "float", vector: true },
  coInt: { type: "int", vector: false },
  coInts: { type: "int", vector: true },
  coBool: { type: "bool", vector: false },
  coBools: { type: "bool", vector: true },
  coString: { type: "string", vector: false },
  coStrings: { type: "string", vector: true },
  coEnum: { type: "enum", vector: false },
  coPercent: { type: "percent", vector: false },
  coPercents: { type: "percent", vector: true },
};

export function parsePrintConfig(cppSource: string): Record<string, SchemaOption> {
  const options: Record<string, SchemaOption> = {};
  // Split into blocks starting at each `def = this->add("key", coType)` line.
  const blockRe = /def\s*=\s*this->add\("([^"]+)",\s*(co\w+)\)([\s\S]*?)(?=def\s*=\s*this->add\(|$)/g;
  for (const match of cppSource.matchAll(blockRe)) {
    const [, key, coType, body] = match;
    const mapped = TYPE_MAP[coType];
    if (!mapped) continue;

    const option: SchemaOption = { type: mapped.type, vector: mapped.vector };
    const min = body.match(/def->min\s*=\s*(-?[\d.]+)/);
    if (min) option.min = Number(min[1]);
    const max = body.match(/def->max\s*=\s*(-?[\d.]+)/);
    if (max) option.max = Number(max[1]);
    if (mapped.type === "enum") {
      option.enum = [...body.matchAll(/enum_values\.push_back\("([^"]+)"\)/g)].map((m) => m[1]);
    }
    const def = body.match(/set_default_value\(new\s+ConfigOption\w+(?:<[^>]+>)?\s*[({]\s*([^)}]*?)\s*[)}]\)/);
    if (def && def[1] !== "") {
      const text = def[1];
      if (text === "true" || text === "false") option.default = text === "true";
      else if (/^-?[\d.]+$/.test(text)) option.default = Number(text);
      else option.default = text.replace(/^"|"$/g, "");
    }
    options[key] = option;
  }
  return options;
}

/** Strips C++ `/* block *\/` and `// line` comments so commented-out keys are not extracted. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Extracts the quoted option keys from a `print_options()` / `filament_options()` list body. */
export function parseOptionList(cppSource: string, fnName: string): string[] {
  // `Preset::<fnName>()` commonly just returns a static vector defined elsewhere,
  // e.g. `const std::vector<std::string>& Preset::print_options() { return s_Preset_print_options; }`.
  const indirect = cppSource.match(new RegExp(`${fnName}\\s*\\(\\)\\s*\\{\\s*return\\s+(\\w+)\\s*;\\s*\\}`));
  if (indirect) {
    const varName = indirect[1];
    const decl = cppSource.match(new RegExp(`\\b${varName}\\s*\\{([\\s\\S]*?)\\}\\s*;`));
    if (decl) return [...stripComments(decl[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  // Fallback: the list is inlined directly in the function body.
  const fn = cppSource.match(new RegExp(`${fnName}\\s*\\(\\)[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`));
  if (!fn) return [];
  return [...stripComments(fn[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
