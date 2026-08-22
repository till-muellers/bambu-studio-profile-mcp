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

/**
 * Extracts the raw argument text passed to `set_default_value(new ConfigOptionXxx<...>(...))` /
 * `set_default_value(new ConfigOptionXxx<...>{...})`, unwrapping exactly one level of call-parens
 * and/or brace-init-list around the value(s). Handles both single-value scalars
 * (`ConfigOptionFloat(0.2)`) and brace-initialized (possibly vector) defaults
 * (`ConfigOptionBoolsNullable({false})`, `ConfigOptionFloats{200}`, `ConfigOptionFloats( { 1., 1.} )`).
 * Returns `undefined` if no `set_default_value(new ConfigOption...)` call is found in `body`.
 */
function extractDefaultRaw(body: string): string | undefined {
  const prefix = body.match(/set_default_value\(\s*new\s+ConfigOption\w+(?:<[^>]+>)?\s*/);
  if (!prefix || prefix.index === undefined) return undefined;
  const start = prefix.index + prefix[0].length;
  const openChar = body[start];
  if (openChar !== "(" && openChar !== "{") return undefined;

  let depth = 0;
  let end = start;
  for (; end < body.length; end++) {
    const ch = body[end];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }

  let content = body.slice(start + 1, end - 1).trim();
  if (content.startsWith("{") && content.endsWith("}")) {
    content = content.slice(1, -1).trim();
  }
  return content;
}

function parseScalar(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?[\d.]+$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^"|"$/g, "");
}

/** Parses the unwrapped default-value text into a scalar, or an array for brace-init lists of >1 value. */
function parseDefaultValue(raw: string): unknown {
  if (raw === "") return undefined;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return undefined;
  const values = parts.map(parseScalar);
  return values.length === 1 ? values[0] : values;
}

/**
 * C++ often constructs a bool option's default from an int literal (`ConfigOptionBool(0)`,
 * `ConfigOptionBool(1)`) since `int` implicitly converts to `bool`. Coerce those back to real
 * booleans (recursing into arrays for vector bool options) so a bool-typed schema entry's default
 * is always `true`/`false`, never `0`/`1`.
 */
function coerceDefault(value: unknown, type: SchemaType): unknown {
  if (type !== "bool") return value;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? v !== 0 : v));
  return value;
}

export function parsePrintConfig(cppSource: string): Record<string, SchemaOption> {
  const options: Record<string, SchemaOption> = {};
  const aliasToKey: Record<string, string> = {};
  // Split into blocks starting at each `[auto <alias> =] def = this->add("key", coType)` line.
  const blockRe =
    /(?:auto\s+(\w+)\s*=\s*)?def\s*=\s*this->add\("([^"]+)",\s*(co\w+)\)([\s\S]*?)(?=(?:auto\s+\w+\s*=\s*)?def\s*=\s*this->add\(|$)/g;
  for (const match of cppSource.matchAll(blockRe)) {
    const [, alias, key, coType, body] = match;
    const mapped = TYPE_MAP[coType];
    if (!mapped) continue;

    const option: SchemaOption = { type: mapped.type, vector: mapped.vector };
    const min = body.match(/def->min\s*=\s*(-?[\d.]+)/);
    if (min) option.min = Number(min[1]);
    const max = body.match(/def->max\s*=\s*(-?[\d.]+)/);
    if (max) option.max = Number(max[1]);
    if (mapped.type === "enum") {
      const pushed = [...body.matchAll(/enum_values\.(?:push_back|emplace_back)\("([^"]+)"\)/g)].map((m) => m[1]);
      if (pushed.length > 0) {
        option.enum = pushed;
      } else {
        // Some options alias another option's already-declared def (`auto def_x = def = this->add(...)`)
        // and copy its enum list via `def->enum_values = def_x->enum_values;` instead of push_back/emplace_back.
        const ref = body.match(/enum_values\s*=\s*(\w+)->enum_values/);
        const sourceKey = ref ? aliasToKey[ref[1]] : undefined;
        const sourceEnum = sourceKey ? options[sourceKey]?.enum : undefined;
        option.enum = sourceEnum ? [...sourceEnum] : [];
      }
    }
    const rawDefault = extractDefaultRaw(body);
    if (rawDefault !== undefined) {
      const parsed = parseDefaultValue(rawDefault);
      if (parsed !== undefined) option.default = coerceDefault(parsed, mapped.type);
    }
    options[key] = option;
    if (alias) aliasToKey[alias] = key;
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
