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

export interface ProfileListing {
  name: string;
  source: "user" | "system";
  vendor?: string;
  inherits?: string;
}

async function scanDirForListing(
  dir: string,
  source: "user" | "system",
  vendor?: string
): Promise<ProfileListing[]> {
  if (!existsSync(dir)) return [];
  const listings: ProfileListing[] = [];
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(dir, entry), "utf8"));
    } catch {
      continue; // unreadable/non-JSON files are not candidates
    }
    if (!parsed || typeof parsed !== "object") continue;
    const profile = parsed as RawProfile;
    if (typeof profile.name !== "string") continue;
    const listing: ProfileListing = { name: profile.name, source };
    if (vendor !== undefined) listing.vendor = vendor;
    if (typeof profile.inherits === "string") listing.inherits = profile.inherits;
    listings.push(listing);
  }
  return listings;
}

async function listVendorDirNames(profilesDir: string): Promise<string[]> {
  if (!existsSync(profilesDir)) return [];
  const dirents = await readdir(profilesDir, { withFileTypes: true });
  return dirents.filter((d) => d.isDirectory()).map((d) => d.name);
}

/**
 * List profiles across the user preset store and the system store. When `vendor` is given, the
 * system side is scoped to that vendor's directory (unknown vendor rejects with
 * VendorNotFoundError). When omitted, every vendor subdirectory of resources/profiles is scanned;
 * missing/unknown directories contribute nothing rather than throwing.
 */
export async function listProfiles(
  cfg: ServerConfig,
  kind: ProfileKind,
  vendor?: string
): Promise<ProfileListing[]> {
  const userDir = join(cfg.userDataDir, "user", cfg.userId, kind);
  const userEntries = (await scanDirForListing(userDir, "user")).sort((a, b) => a.name.localeCompare(b.name));

  const profilesDir = join(cfg.installDir, "resources", "profiles");
  let systemEntries: ProfileListing[] = [];
  if (vendor !== undefined) {
    const vendorDir = join(profilesDir, vendor);
    if (!existsSync(vendorDir)) throw new VendorNotFoundError(vendor);
    systemEntries = await scanDirForListing(join(vendorDir, kind), "system", vendor);
  } else {
    for (const vendorName of await listVendorDirNames(profilesDir)) {
      systemEntries.push(...(await scanDirForListing(join(profilesDir, vendorName, kind), "system", vendorName)));
    }
  }
  systemEntries.sort((a, b) => (a.vendor ?? "").localeCompare(b.vendor ?? "") || a.name.localeCompare(b.name));

  return [...userEntries, ...systemEntries];
}

async function countJsonFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  return (await readdir(dir)).filter((entry) => entry.endsWith(".json")).length;
}

/** List vendor folders under resources/profiles with per-kind profile counts. */
export async function listVendors(
  cfg: ServerConfig
): Promise<{ name: string; processCount: number; filamentCount: number }[]> {
  const profilesDir = join(cfg.installDir, "resources", "profiles");
  const vendorNames = (await listVendorDirNames(profilesDir)).sort((a, b) => a.localeCompare(b));
  const vendors = [];
  for (const name of vendorNames) {
    vendors.push({
      name,
      processCount: await countJsonFiles(join(profilesDir, name, "process")),
      filamentCount: await countJsonFiles(join(profilesDir, name, "filament")),
    });
  }
  return vendors;
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
