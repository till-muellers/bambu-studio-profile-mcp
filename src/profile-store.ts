import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VendorNotFoundError } from "./errors.js";
import type { ProfileHit, ProfileKind, ProfileStore, RawProfile, ServerConfig } from "./types.js";

async function scanDirForName(
  dir: string,
  name: string
): Promise<{ profile: RawProfile; path: string } | null> {
  if (!existsSync(dir)) return null;
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue; // unreadable/non-JSON files are not candidates
    }
    const profile = parsed as RawProfile;
    if (profile && typeof profile === "object" && profile.name === name) {
      return { profile, path };
    }
  }
  return null;
}

export class FsProfileStore implements ProfileStore {
  constructor(private readonly cfg: ServerConfig) {}

  async findProfile(kind: ProfileKind, vendor: string, name: string): Promise<ProfileHit | null> {
    const userDir = join(this.cfg.userDataDir, "user", this.cfg.userId, kind);
    const userHit = await scanDirForName(userDir, name);
    if (userHit) return { ...userHit, source: "user" };

    const vendorDir = join(this.cfg.installDir, "resources", "profiles", vendor);
    if (!existsSync(vendorDir)) throw new VendorNotFoundError(vendor);
    const systemHit = await scanDirForName(join(vendorDir, kind), name);
    return systemHit ? { ...systemHit, source: "system" } : null;
  }
}

export async function writeProfileFile(
  outputDir: string,
  name: string,
  body: Record<string, unknown>
): Promise<{ path: string; created: boolean }> {
  await mkdir(outputDir, { recursive: true });
  const path = join(outputDir, `${name}.json`);
  const created = !existsSync(path);
  await writeFile(path, JSON.stringify(body, null, 4) + "\n", "utf8");
  return { path, created };
}
