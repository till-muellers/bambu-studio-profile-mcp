import { readFile } from "node:fs/promises";
import type { ProfileSchema, SchemaOption, Violation } from "./types.js";
import { strings } from "./strings.js";

export async function loadSchema(path: string): Promise<ProfileSchema> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(strings.messages.schemaFileMissing(path));
  }
  try {
    return JSON.parse(raw) as ProfileSchema;
  } catch {
    throw new Error(strings.messages.schemaFileInvalid(path));
  }
}

function parseNumeric(option: SchemaOption, value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = option.type === "percent" ? value.replace(/%$/, "") : value;
  if (option.type === "int" && !/^-?\d+$/.test(text)) return undefined;
  if (text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Validates one scalar value (or one vector element). Returns the failure reason or null. */
function checkScalar(option: SchemaOption, value: unknown): string | null {
  if (option.nullable === true && value === "nil") return null;
  switch (option.type) {
    case "string":
      return typeof value === "string" ? null : strings.violations.expectedString(value);
    case "enum": {
      const allowed = option.enum ?? [];
      return typeof value === "string" && allowed.includes(value)
        ? null
        : strings.violations.expectedEnum(allowed, value);
    }
    case "bool": {
      const ok =
        typeof value === "boolean" ||
        (typeof value === "string" && ["0", "1", "true", "false"].includes(value));
      return ok ? null : strings.violations.expectedBool(value);
    }
    case "int":
    case "float":
    case "percent": {
      const parsed = parseNumeric(option, value);
      if (parsed === undefined) {
        const typeLabel = option.type === "int" ? "an integer" : `a ${option.type}`;
        return strings.violations.expectedNumeric(typeLabel, value);
      }
      if (option.min !== undefined && parsed < option.min) {
        return strings.violations.belowMinimum(parsed, option.min);
      }
      if (option.max !== undefined && parsed > option.max) {
        return strings.violations.aboveMaximum(parsed, option.max);
      }
      return null;
    }
  }
}

function checkValue(key: string, option: SchemaOption, value: unknown): Violation | null {
  if (option.vector) {
    if (!Array.isArray(value) || value.length === 0) {
      return { key, reason: strings.violations.expectedVector(option.type, value) };
    }
    const elementReasons = value
      .map((element, index) => {
        const reason = checkScalar(option, element);
        return reason ? strings.violations.element(index, reason) : null;
      })
      .filter((r): r is string => r !== null);
    return elementReasons.length > 0 ? { key, reason: elementReasons.join("; ") } : null;
  }
  if (Array.isArray(value)) {
    return { key, reason: strings.violations.expectedScalar(option.type) };
  }
  const reason = checkScalar(option, value);
  return reason ? { key, reason } : null;
}

export function validateKvps(schema: ProfileSchema, kvps: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(kvps)) {
    const option = schema[key];
    if (!option) {
      violations.push({ key, reason: strings.violations.unknownKey });
      continue;
    }
    const violation = checkValue(key, option, value);
    if (violation) violations.push(violation);
  }
  return violations;
}
