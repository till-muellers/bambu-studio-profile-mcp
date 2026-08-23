import { join } from "node:path";
import { strings } from "./strings.js";
import type { ProfileKind, ServerConfig } from "./types.js";

export const STUDIO_RESTART_NOTE = strings.messages.studioRestartNote;

export function userPresetPaths(
  cfg: ServerConfig,
  kind: ProfileKind,
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
 * as non-content. Identity keys (name, inherits) are tool-specific and stay at the call sites.
 */
export const SYNTHESIZED_METADATA_KEYS = [
  "from",
  "version",
  "print_settings_id",
  "filament_settings_id",
] as const;

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
