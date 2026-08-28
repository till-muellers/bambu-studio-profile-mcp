import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ConfigMissingError } from "./errors.js";
import type { ServerConfig } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Resolve the per-project config directory (first match wins):
 * 1. BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR — used verbatim, no subdirectory appended.
 * 2. CLAUDE_PROJECT_DIR — Claude Code sets this for stdio MCP servers; config dir is
 *    <CLAUDE_PROJECT_DIR>/.bambu-studio-profile-mcp.
 * 3. cwd — fallback; config dir is <cwd>/.bambu-studio-profile-mcp.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv, cwd: string): string {
  if (env.BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR) return env.BAMBU_STUDIO_PROFILE_MCP_CONFIG_DIR;
  if (env.CLAUDE_PROJECT_DIR) return join(env.CLAUDE_PROJECT_DIR, ".bambu-studio-profile-mcp");
  return join(cwd, ".bambu-studio-profile-mcp");
}

export type DetectedPaths = Partial<Pick<ServerConfig, "installDir" | "userDataDir">>;

async function detectWindowsInstallDir(): Promise<string | undefined> {
  // The install drive varies, so read the uninstall entry's DisplayIcon (path to bambu-studio.exe).
  for (const hive of ["HKLM", "HKCU"]) {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query",
        `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall`,
        "/s",
        "/f",
        "Bambu Studio",
      ]);
      const icon = stdout.match(/DisplayIcon\s+REG_SZ\s+(.+bambu-studio\.exe)/i);
      if (icon) return dirname(icon[1].trim());
    } catch {
      // hive missing or reg query found nothing — try the next hive
    }
  }
  return undefined;
}

/** Best-effort; each field is present only if its layout check passes. userId is never detected. */
export async function detectDefaultPaths(): Promise<DetectedPaths> {
  const installCandidates: string[] = [];
  const userDataCandidates: string[] = [];
  if (process.platform === "win32") {
    const fromRegistry = await detectWindowsInstallDir();
    if (fromRegistry) installCandidates.push(fromRegistry);
    installCandidates.push("C:\\Program Files\\Bambu Studio");
    if (process.env.APPDATA) userDataCandidates.push(join(process.env.APPDATA, "BambuStudio"));
  } else if (process.platform === "darwin") {
    installCandidates.push("/Applications/BambuStudio.app/Contents");
    userDataCandidates.push(join(homedir(), "Library", "Application Support", "BambuStudio"));
  } else {
    installCandidates.push("/usr/share/BambuStudio", "/opt/bambustudio");
    userDataCandidates.push(join(homedir(), ".config", "BambuStudio"));
  }
  const result: DetectedPaths = {};
  const installDir = installCandidates.find((d) => existsSync(join(d, "resources", "profiles")));
  if (installDir) result.installDir = installDir;
  const userDataDir = userDataCandidates.find((d) => existsSync(join(d, "user")));
  if (userDataDir) result.userDataDir = userDataDir;
  return result;
}

/**
 * Best-effort read of BambuStudio.conf's `app` object. Never throws. The file is JSON followed by a
 * non-JSON trailer line (a "# MD5 checksum ..." comment), so the content is trimmed to the outermost
 * {...} span before parsing; a leading BOM is stripped as well.
 */
async function readAppSection(
  userDataDir: string
): Promise<Record<string, unknown> | undefined> {
  const confPath = join(userDataDir, "BambuStudio.conf");
  if (!existsSync(confPath)) return undefined;
  try {
    let text = await readFile(confPath, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return undefined;
    const raw: unknown = JSON.parse(text.slice(start, end + 1));
    const app = (raw as { app?: unknown })?.app;
    if (typeof app !== "object" || app === null || Array.isArray(app)) return undefined;
    return app as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function appString(app: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = app?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The logged-in account's preset folder name (BambuStudio.conf's app.preset_folder). */
export async function readPresetFolder(userDataDir: string): Promise<string | undefined> {
  return appString(await readAppSection(userDataDir), "preset_folder");
}

/**
 * The version of the Bambu Studio application that last ran: BambuStudio.conf's app.version, which
 * Studio writes as SLIC3R_VERSION on every startup. One release stale between an update and the
 * next launch.
 */
export async function readAppVersion(userDataDir: string): Promise<string | undefined> {
  return appString(await readAppSection(userDataDir), "version");
}

export async function validateConfigPaths(cfg: ServerConfig): Promise<string[]> {
  const problems: string[] = [];
  if (!existsSync(join(cfg.installDir, "resources", "profiles"))) {
    problems.push(`installDir '${cfg.installDir}' does not contain resources/profiles.`);
  }
  if (!existsSync(join(cfg.userDataDir, "user", cfg.userId))) {
    problems.push(`userDataDir '${cfg.userDataDir}' does not contain user/${cfg.userId}.`);
  }
  return problems;
}

export class ConfigManager {
  constructor(private readonly configPath: string) {}

  async load(): Promise<ServerConfig | null> {
    if (!existsSync(this.configPath)) return null;
    const raw: unknown = JSON.parse(await readFile(this.configPath, "utf8"));
    const cfg = raw as ServerConfig;
    if (
      typeof cfg.installDir === "string" &&
      typeof cfg.userDataDir === "string" &&
      typeof cfg.userId === "string"
    ) {
      return { installDir: cfg.installDir, userDataDir: cfg.userDataDir, userId: cfg.userId };
    }
    return null;
  }

  async require(): Promise<ServerConfig> {
    const cfg = await this.load();
    if (!cfg) throw new ConfigMissingError();
    return cfg;
  }

  async save(cfg: ServerConfig): Promise<string> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    return this.configPath;
  }
}
