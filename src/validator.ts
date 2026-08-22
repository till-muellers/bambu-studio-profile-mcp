import { readFile } from "node:fs/promises";
import type { ProfileSchema, SchemaOption, Violation } from "./types.js";

export async function loadSchema(path: string): Promise<ProfileSchema> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Schema file '${path}' not found. Run scripts/generate-schema to produce it.`);
  }
  try {
    return JSON.parse(raw) as ProfileSchema;
  } catch {
    throw new Error(`Schema file '${path}' is not valid JSON.`);
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
      return typeof value === "string" ? null : `expected a string, got ${JSON.stringify(value)}`;
    case "enum": {
      const allowed = option.enum ?? [];
      return typeof value === "string" && allowed.includes(value)
        ? null
        : `expected one of [${allowed.join(", ")}], got ${JSON.stringify(value)}`;
    }
    case "bool": {
      const ok =
        typeof value === "boolean" ||
        (typeof value === "string" && ["0", "1", "true", "false"].includes(value));
      return ok ? null : `expected a bool (true/false/"0"/"1"), got ${JSON.stringify(value)}`;
    }
    case "int":
    case "float":
    case "percent": {
      const parsed = parseNumeric(option, value);
      if (parsed === undefined) {
        return `expected ${option.type === "int" ? "an integer" : `a ${option.type}`}, got ${JSON.stringify(value)}`;
      }
      if (option.min !== undefined && parsed < option.min) {
        return `value ${parsed} is below minimum ${option.min}`;
      }
      if (option.max !== undefined && parsed > option.max) {
        return `value ${parsed} is above maximum ${option.max}`;
      }
      return null;
    }
  }
}

function checkValue(key: string, option: SchemaOption, value: unknown): Violation | null {
  if (option.vector) {
    if (!Array.isArray(value) || value.length === 0) {
      return { key, reason: `expected a non-empty array of ${option.type} values, got ${JSON.stringify(value)}` };
    }
    const elementReasons = value
      .map((element, index) => {
        const reason = checkScalar(option, element);
        return reason ? `element ${index}: ${reason}` : null;
      })
      .filter((r): r is string => r !== null);
    return elementReasons.length > 0 ? { key, reason: elementReasons.join("; ") } : null;
  }
  if (Array.isArray(value)) {
    return { key, reason: `expected a single ${option.type} value, got an array` };
  }
  const reason = checkScalar(option, value);
  return reason ? { key, reason } : null;
}

export function validateKvps(schema: ProfileSchema, kvps: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(kvps)) {
    const option = schema[key];
    if (!option) {
      violations.push({ key, reason: "unknown key (not present in the schema)" });
      continue;
    }
    const violation = checkValue(key, option, value);
    if (violation) violations.push(violation);
  }
  return violations;
}
