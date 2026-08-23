import { join } from "node:path";
import type { ProfileKind, ServerConfig } from "./types.js";

export const STUDIO_RESTART_NOTE = "Bambu Studio picks this up after a restart.";

export function userPresetPaths(
  cfg: ServerConfig,
  kind: ProfileKind,
  name: string
): { jsonPath: string; infoPath: string } {
  if (/[/\\]/.test(name) || name === "." || name === "..") {
    throw new Error(
      `Invalid profile name '${name}': must be a plain filename without path separators.`
    );
  }
  const dir = join(cfg.userDataDir, "user", cfg.userId, kind);
  return { jsonPath: join(dir, `${name}.json`), infoPath: join(dir, `${name}.info`) };
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
