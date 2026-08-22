import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ConfigMissingError } from "./errors.js";
import type { ServerConfig } from "./types.js";

const execFileAsync = promisify(execFile);

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

/** Best-effort read of the logged-in account's preset folder name from BambuStudio.conf. Never throws. */
export async function readPresetFolder(userDataDir: string): Promise<string | undefined> {
  const confPath = join(userDataDir, "BambuStudio.conf");
  if (!existsSync(confPath)) return undefined;
  try {
    const raw: unknown = JSON.parse(await readFile(confPath, "utf8"));
    const presetFolder = (raw as { app?: { preset_folder?: unknown } })?.app?.preset_folder;
    if (typeof presetFolder === "string" && presetFolder.length > 0) return presetFolder;
    return undefined;
  } catch {
    return undefined;
  }
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
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    return this.configPath;
  }
}
