import { join } from "node:path";
import { strings } from "./strings.js";
import type { WritableProfileKind, ServerConfig } from "./types.js";

export const STUDIO_RESTART_NOTE = strings.messages.studioRestartNote;

export function userPresetPaths(
  cfg: ServerConfig,
  kind: WritableProfileKind,
  name: string
): { jsonPath: string; infoPath: string } {
  if (/[/\\]/.test(name) || name === "." || name === "..") {
    throw new Error(strings.messages.invalidProfileName(name));
  }
  const dir = join(cfg.userDataDir, "user", cfg.userId, kind);
  return { jsonPath: join(dir, `${name}.json`), infoPath: join(dir, `${name}.info`) };
}

/**
 * Preset metadata import_profile synthesizes when installing into the user store. Source files
 * never author these: import regenerates them, and every tool reading a profile file treats them
 * as non-content.
 */
export const SYNTHESIZED_METADATA_KEYS = [
  "from",
  "version",
  "print_settings_id",
  "filament_settings_id",
] as const;

/** Neither identity nor content: what a profile file states as its own settings excludes these. */
export const CONTENT_SKIP_KEYS: ReadonlySet<string> = new Set<string>([
  "name",
  "inherits",
  ...SYNTHESIZED_METADATA_KEYS,
]);

/** Identity and metadata only: 'inherits' stays in, since a changed base is a real difference. */
export const COMPARISON_SKIP_KEYS: ReadonlySet<string> = new Set<string>([
  "name",
  ...SYNTHESIZED_METADATA_KEYS,
]);

/** The entries of `values` whose key is not in `skip`, in their original order. */
export function omitKeys(
  values: Record<string, unknown>,
  skip: ReadonlySet<string>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (skip.has(key)) continue;
    kept[key] = value;
  }
  return kept;
}

/** Exact byte layout Bambu Studio's Preset::save_info writes on Windows: five fields, CRLF. */
export function formatInfoSidecar(updatedTime: number): string {
  return (
    "sync_info = \r\n" +
    "user_id = \r\n" +
    "setting_id = \r\n" +
    "base_id = \r\n" +
    `updated_time = ${updatedTime}\r\n`
  );
}

export function parseSettingId(infoText: string): string {
  const match = infoText.match(/^setting_id\s*=[ \t]*(.*?)\s*$/m);
  return match ? match[1] : "";
}
