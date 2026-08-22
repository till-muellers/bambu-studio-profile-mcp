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

/** List vendor folder names under resources/profiles, sorted. */
export async function listVendors(cfg: ServerConfig): Promise<string[]> {
  const profilesDir = join(cfg.installDir, "resources", "profiles");
  return (await listVendorDirNames(profilesDir)).sort((a, b) => a.localeCompare(b));
}

async function collectFilamentIds(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(dir, entry), "utf8"));
    } catch {
      continue; // unreadable/non-JSON files are not candidates
    }
    if (!parsed || typeof parsed !== "object") continue;
    const filamentId = (parsed as RawProfile).filament_id;
    if (typeof filamentId === "string" && filamentId.length > 0) ids.push(filamentId);
  }
  return ids;
}

/**
 * Collects the distinct `filament_id` values across the configured user filament store and every
 * vendor's system filament directory. Missing/unknown directories contribute nothing rather than
 * throwing; profiles without a `filament_id` are skipped.
 */
export async function listFilamentIds(cfg: ServerConfig): Promise<string[]> {
  const userDir = join(cfg.userDataDir, "user", cfg.userId, "filament");
  const profilesDir = join(cfg.installDir, "resources", "profiles");

  const ids = new Set<string>(await collectFilamentIds(userDir));
  for (const vendorName of await listVendorDirNames(profilesDir)) {
    for (const id of await collectFilamentIds(join(profilesDir, vendorName, "filament"))) {
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
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
