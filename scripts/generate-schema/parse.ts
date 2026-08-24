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
  coEnums: { type: "enum", vector: true },
  coPercent: { type: "percent", vector: false },
  coPercents: { type: "percent", vector: true },
  // Point-family options serialize into preset JSON as "XxY" strings — a bare string for coPoint,
  // an array of them for coPoints, and an array of comma-joined point lists for coPointsGroups.
  coPoint: { type: "string", vector: false },
  coPoints: { type: "string", vector: true },
  coPointsGroups: { type: "string", vector: true },
};

const POINT_TYPES = new Set(["coPoint", "coPoints", "coPointsGroups"]);

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

/**
 * Decodes the C++ backslash escapes that appear in string literals we care about: `\n`, `\t`,
 * `\r`, `\"`, `\\`. Unrecognized escapes keep their trailing character as-is (matches the prior,
 * uniform-unescape behavior for anything not in that set).
 */
function decodeCppEscapes(text: string): string {
  return text.replace(/\\(.)/g, (_match, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return ch; // covers \" -> ", \\ -> \, and any other escape -> its literal character
    }
  });
}

/**
 * Extracts `def->label = L(...)` where the L(...) argument is one or more adjacent quoted
 * string literals (C++ string-literal concatenation, optionally spanning multiple lines), e.g.
 * `def->label = L("part a " "part b")`. C++ adjacent string literals concatenate with NO
 * implicit separator, so the literals' decoded contents are joined directly (any word-boundary
 * spacing must already be present inside the literals themselves, as it is in the source). Returns
 * `undefined` when the field is absent from `body`.
 */
function extractLField(body: string): string | undefined {
  const re = /def->label\s*=\s*L\(\s*((?:"(?:[^"\\]|\\.)*"\s*)+)\)/;
  const match = body.match(re);
  if (!match) return undefined;
  const literals = match[1].match(/"(?:[^"\\]|\\.)*"/g);
  if (!literals) return undefined;
  return literals.map((lit) => decodeCppEscapes(lit.slice(1, -1))).join("");
}

function parseScalar(text: string): unknown {
  let trimmed = text.trim();
  // Unwrap the C++ localization macro, e.g. `L("(Undefined)")` -> `"(Undefined)"`.
  const localized = trimmed.match(/^L\(\s*("[^"]*")\s*\)$/);
  if (localized) trimmed = localized[1];
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

/** Lowercases and drops every non-alphanumeric character, so "normal(auto)" and "NormalAuto" meet. */
function normalizeEnumToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Turns the C++ default of an enum option into the enum token it names, or `undefined` when it
 * names nothing the option declares. A plain integer (with any `(int)` cast stripped) indexes
 * `enumValues`. An enum constant — scoped (`ZHopType::zhtSpiral`) or bare (`btAutoBrim`) — matches a
 * token only when the two normalize identically, either whole or with the constant's leading
 * lowercase type prefix removed. Matching is exact on purpose: `ipRectilinear` must not be talked
 * into `alignedrectilinear`. An omitted default is correct; a fabricated one is a defect.
 */
export function resolveEnumDefault(rawDefault: string, enumValues: string[]): string | undefined {
  const text = rawDefault.replace(/\(\s*int\s*\)/g, "").trim();
  if (text === "") return undefined;

  if (/^\d+$/.test(text)) return enumValues[Number(text)];

  const identifier = text.includes("::") ? text.slice(text.lastIndexOf("::") + 2).trim() : text;
  const candidates = [identifier, identifier.replace(/^[a-z]+(?=[A-Z])/, "")]
    .map(normalizeEnumToken)
    .filter((candidate) => candidate !== "");

  for (const candidate of candidates) {
    const hit = enumValues.find((value) => normalizeEnumToken(value) === candidate);
    if (hit !== undefined) return hit;
  }
  // Enum tokens often carry a trailing noun the constant drops ("zhtSpiral" -> "Spiral Lift").
  // Accept that only when exactly one token starts with the candidate, so an ambiguous stem
  // resolves to nothing rather than to a near neighbour.
  for (const candidate of candidates) {
    const hits = enumValues.filter((value) => normalizeEnumToken(value).startsWith(candidate));
    if (hits.length === 1) return hits[0];
  }
  return undefined;
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
    const label = extractLField(body);
    if (label !== undefined) option.label = label;
    if (/def->nullable\s*=\s*true\s*;/.test(body)) option.nullable = true;
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
    // A point-family default is written as C++ constructor calls (`ConfigOptionPoints{ Vec2d(0,0) }`),
    // which carries no honest rendering into the "XxY" string form preset files use. Omit it.
    if (!POINT_TYPES.has(coType)) {
      const rawDefault = extractDefaultRaw(body);
      if (rawDefault !== undefined && mapped.type === "enum") {
        const resolved = resolveEnumDefault(rawDefault, option.enum ?? []);
        if (resolved !== undefined) option.default = resolved;
      } else if (rawDefault !== undefined) {
        const parsed = parseDefaultValue(rawDefault);
        if (parsed !== undefined) option.default = coerceDefault(parsed, mapped.type);
      }
    }
    options[key] = option;
    if (alias) aliasToKey[alias] = key;
  }
  return options;
}

/**
 * Applies a description overlay (option key -> description text) onto a set of parsed schema
 * options, mutating each matching option's `description` in place. Reports coverage: `applied` is
 * the number of options that received a description, `missing` lists option keys with no overlay
 * entry (in `options` iteration order), and `stale` lists overlay keys that matched no option (in
 * overlay iteration order).
 */
export function applyDescriptions(
  options: Record<string, SchemaOption>,
  overlay: Record<string, string>
): { applied: number; missing: string[]; stale: string[] } {
  let applied = 0;
  const missing: string[] = [];
  for (const [key, option] of Object.entries(options)) {
    const description = overlay[key];
    if (description !== undefined) {
      option.description = description;
      applied++;
    } else {
      missing.push(key);
    }
  }
  const stale = Object.keys(overlay).filter((key) => !(key in options));
  return { applied, missing, stale };
}

/** Extracts the quoted keys of a `const std::vector<std::string> <name> = { ... };` declaration. */
export function parseStringVector(cppSource: string, name: string): string[] {
  const decl = cppSource.match(new RegExp(`std::vector<std::string>\\s+${name}\\s*=?\\s*\\{([\\s\\S]*?)\\}\\s*;`));
  if (!decl) return [];
  return [...stripComments(decl[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Mirrors PrintConfig.cpp's filament-override synthesis loops: each `filament_<base>` key in the
 * two override vectors is added as a clone of its base option's facts (type, vector, label,
 * min/max, enum values, default). Extruder-override clones are always nullable (`add_nullable`);
 * overhang-override clones take the base option's own nullable flag. Throws when a base option is
 * absent from `options` (the C++ loops assert the same).
 */
export function synthesizeFilamentOverrides(
  options: Record<string, SchemaOption>,
  extruderOverrideKeys: string[],
  overhangOverrideKeys: string[]
): void {
  const clone = (key: string): SchemaOption => {
    const base = options[key.replace(/^filament_/, "")];
    if (!base) {
      throw new Error(`Override option '${key}' has no parsed base option to clone from.`);
    }
    const out: SchemaOption = { type: base.type, vector: base.vector };
    if (base.label !== undefined) out.label = base.label;
    if (base.min !== undefined) out.min = base.min;
    if (base.max !== undefined) out.max = base.max;
    if (base.enum !== undefined) out.enum = [...base.enum];
    if (base.default !== undefined) out.default = base.default;
    return out;
  };
  for (const key of extruderOverrideKeys) {
    options[key] = { ...clone(key), nullable: true };
  }
  for (const key of overhangOverrideKeys) {
    const base = options[key.replace(/^filament_/, "")];
    const cloned = clone(key);
    if (base?.nullable) cloned.nullable = true;
    options[key] = cloned;
  }
}

/** Strips C++ `/* block *\/` and `// line` comments so commented-out keys are not extracted. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Extracts the extruder-scoped option keys from PrintConfig.cpp's
 * `PrintConfigDef::init_extruder_option_keys()`. `Preset::nozzle_options()` returns exactly this
 * list (`print_config_def.extruder_option_keys()`), so it is the machine option set's third
 * contribution.
 */
export function parseExtruderOptionKeys(cppSource: string): string[] {
  const decl = cppSource.match(/m_extruder_option_keys\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!decl) return [];
  return [...stripComments(decl[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Expands PrintConfig.cpp's machine-limit axis loop. The loop builds each key by concatenation
 * (`this->add("machine_max_speed_" + axis.name, coFloats)`) over a literal `AxisDefault` table, so
 * the generic `this->add("key", coType)` block scan cannot see these options. Facts come from the
 * loop body; each option's default is the `AxisDefault` column its `set_default_value` call names.
 * Returns an empty record when the loop is absent.
 */
export function parseAxisLimitOptions(cppSource: string): Record<string, SchemaOption> {
  const struct = cppSource.match(/struct\s+AxisDefault\s*\{([\s\S]*?)\}\s*;/);
  const table = cppSource.match(/std::vector<AxisDefault>\s+axes\s*\{([\s\S]*?)\n\s*\}\s*;/);
  if (!struct || !table) return {};

  // Struct field order fixes the column order of each table row after the leading axis name.
  const columns = [...struct[1].matchAll(/std::vector<double>\s+(\w+)\s*;/g)].map((m) => m[1]);
  const axes: { name: string; columns: Record<string, number[]> }[] = [];
  const rowRe = /\{\s*"(\w+)"\s*,((?:[^{}]|\{[^{}]*\})*)\}/g;
  for (const row of stripComments(table[1]).matchAll(rowRe)) {
    const groups = [...row[2].matchAll(/\{([^{}]*)\}/g)].map((g) =>
      g[1]
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "")
        .map(Number)
    );
    const byColumn: Record<string, number[]> = {};
    columns.forEach((column, index) => {
      if (groups[index]) byColumn[column] = groups[index];
    });
    axes.push({ name: row[1], columns: byColumn });
  }

  const options: Record<string, SchemaOption> = {};
  const blockRe =
    /def\s*=\s*this->add\(\s*"([^"]+)"\s*\+\s*axis\.name\s*,\s*(co\w+)\s*\)([\s\S]*?)(?=def\s*=\s*this->add\(|$)/g;
  for (const [, prefix, coType, body] of cppSource.matchAll(blockRe)) {
    const mapped = TYPE_MAP[coType];
    if (!mapped) continue;
    const column = body.match(/set_default_value\([\s\S]*?axis\.(\w+)\s*\)/)?.[1];
    const min = body.match(/def->min\s*=\s*(-?[\d.]+)/);
    const max = body.match(/def->max\s*=\s*(-?[\d.]+)/);
    for (const axis of axes) {
      const option: SchemaOption = { type: mapped.type, vector: mapped.vector };
      if (/def->nullable\s*=\s*true\s*;/.test(body)) option.nullable = true;
      if (min) option.min = Number(min[1]);
      if (max) option.max = Number(max[1]);
      const values = column ? axis.columns[column] : undefined;
      if (values !== undefined) option.default = values.length === 1 ? values[0] : values;
      options[prefix + axis.name] = option;
    }
  }
  return options;
}

/**
 * Extracts the machine (printer) option keys. `Preset::printer_options()` composes
 * `s_Preset_printer_options`, `s_Preset_machine_limits_options`, and `Preset::nozzle_options()`;
 * the last is `print_config_def.extruder_option_keys()`, built at runtime and not statically
 * parseable, so it is supplied separately. Returns the union of the two static vectors in
 * declaration order, deduplicated.
 */
export function parsePrinterOptionList(cppSource: string): string[] {
  const keys = [
    ...parseStringVector(cppSource, "s_Preset_printer_options"),
    ...parseStringVector(cppSource, "s_Preset_machine_limits_options"),
  ];
  return [...new Set(keys)];
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
