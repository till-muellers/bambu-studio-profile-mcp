import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strings } from "./strings.js";
import type { ServerConfig } from "./types.js";

/**
 * Version an install writes when the vendor index supplies none. Its major can never exceed the
 * application's, so Bambu Studio always loads a preset carrying it.
 */
export const FALLBACK_PRESET_VERSION = "0.0.0";

/**
 * Normalizes a Bambu version string to the form Studio stores in a preset: three or four
 * dot-separated numeric components with leading zeros stripped ("02.08.00.04" -> "2.8.0.4").
 * Returns undefined for anything Studio's Semver parse would reject.
 */
export function normalizeVersion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const parts = raw.trim().split(".");
  if (parts.length < 3 || parts.length > 4) return undefined;
  if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
  return parts.map((part) => String(Number(part))).join(".");
}

/**
 * The vendor bundle's config version, read from resources/profiles/<vendor>.json and normalized.
 * This is the version Bambu Studio stamps on every preset of that vendor.
 */
export async function readVendorVersion(
  cfg: ServerConfig,
  vendor: string
): Promise<string | undefined> {
  const indexPath = join(cfg.installDir, "resources", "profiles", `${vendor}.json`);
  if (!existsSync(indexPath)) return undefined;
  try {
    const raw: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    return normalizeVersion((raw as { version?: unknown }).version);
  } catch {
    return undefined;
  }
}

export interface Loadability {
  ok: boolean;
  /** Present when ok is false. */
  reason?: string;
  /** True when the application version was available and the major condition was evaluated. */
  appVersionChecked: boolean;
}

/**
 * Whether Bambu Studio loads a user preset carrying this version. Studio skips a preset whose
 * version is absent or unparseable, and one whose major exceeds the running application's. The
 * major condition is evaluated only when the application version is known; an unknown application
 * version never makes a preset unloadable.
 */
export function evaluateLoadability(
  presetVersion: unknown,
  appVersion: string | undefined
): Loadability {
  const normalized = normalizeVersion(presetVersion);
  if (normalized === undefined) {
    return {
      ok: false,
      reason: strings.messages.versionMissingOrUnparseable(presetVersion),
      appVersionChecked: false,
    };
  }
  const app = normalizeVersion(appVersion);
  if (app === undefined) return { ok: true, appVersionChecked: false };
  if (Number(normalized.split(".")[0]) > Number(app.split(".")[0])) {
    return {
      ok: false,
      reason: strings.messages.versionMajorAhead(normalized, app),
      appVersionChecked: true,
    };
  }
  return { ok: true, appVersionChecked: true };
}
