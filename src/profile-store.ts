import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VendorNotFoundError } from "./errors.js";
import type { ProfileHit, ProfileKind, ProfileStore, RawProfile, ServerConfig } from "./types.js";

const READ_CHUNK_SIZE = 64;

interface ParsedJsonFile {
  entry: string;
  parsed: RawProfile;
}

/**
 * Reads and JSON-parses every `*.json` file directly under `dir`, with bounded concurrency
 * (chunks of READ_CHUNK_SIZE, each chunk read+parsed in parallel). Unreadable/unparsable files
 * and files whose parsed content is not a plain object are silently skipped. Returns entries in
 * no particular order — callers that need a deterministic order must sort explicitly.
 */
async function readJsonFiles(dir: string): Promise<ParsedJsonFile[]> {
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((entry) => entry.endsWith(".json"));
  const results: ParsedJsonFile[] = [];
  for (let i = 0; i < entries.length; i += READ_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + READ_CHUNK_SIZE);
    const parsedChunk = await Promise.all(
      chunk.map(async (entry): Promise<ParsedJsonFile | null> => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(join(dir, entry), "utf8"));
        } catch {
          return null; // unreadable/non-JSON files are not candidates
        }
        if (!parsed || typeof parsed !== "object") return null;
        return { entry, parsed: parsed as RawProfile };
      })
    );
    for (const result of parsedChunk) {
      if (result) results.push(result);
    }
  }
  return results;
}

async function scanDirForName(
  dir: string,
  name: string
): Promise<{ profile: RawProfile; path: string } | null> {
  const files = await readJsonFiles(dir);
  const hit = files.find(({ parsed }) => parsed.name === name);
  return hit ? { profile: hit.parsed, path: join(dir, hit.entry) } : null;
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
  const files = await readJsonFiles(dir);
  const listings: ProfileListing[] = [];
  for (const { parsed: profile } of files) {
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

/**
 * List vendor folder names under resources/profiles, sorted by id. `name` is the display name
 * read from the sibling `resources/profiles/<id>.json` metadata file's top-level `name` field
 * (when that file exists, parses, and carries a non-empty string `name`); otherwise `name` falls
 * back to `id`.
 */
export async function listVendors(cfg: ServerConfig): Promise<{ id: string; name: string }[]> {
  const profilesDir = join(cfg.installDir, "resources", "profiles");
  const ids = (await listVendorDirNames(profilesDir)).sort((a, b) => a.localeCompare(b));
  return Promise.all(
    ids.map(async (id) => {
      const metaPath = join(profilesDir, `${id}.json`);
      if (!existsSync(metaPath)) return { id, name: id };
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(metaPath, "utf8"));
      } catch {
        return { id, name: id };
      }
      if (!parsed || typeof parsed !== "object") return { id, name: id };
      const name = (parsed as RawProfile).name;
      return { id, name: typeof name === "string" && name.length > 0 ? name : id };
    })
  );
}

interface FilamentCandidate {
  filamentId: string;
  name: string;
  hasInherits: boolean;
}

async function collectFilamentCandidates(dir: string): Promise<FilamentCandidate[]> {
  const files = await readJsonFiles(dir);
  const candidates: FilamentCandidate[] = [];
  for (const { parsed } of files) {
    const filamentId = parsed.filament_id;
    if (typeof filamentId !== "string" || filamentId.length === 0) continue;
    if (typeof parsed.name !== "string") continue;
    candidates.push({ filamentId, name: parsed.name, hasInherits: typeof parsed.inherits === "string" });
  }
  return candidates;
}

/** Strips a trailing ` @<anything>` suffix (as Bambu Studio uses to mark printer-specific variants). */
function stripAtSuffix(name: string): string {
  return name.replace(/ @.*$/, "").trim();
}

/**
 * Collects the distinct `filament_id` values across the configured user filament store and every
 * vendor's system filament directory, each with a display name. Missing/unknown directories
 * contribute nothing rather than throwing; only profiles that carry both a `filament_id` and a
 * `name` contribute a candidate.
 *
 * The display name for an id is the ` @...`-suffix-stripped `name` of its root carrier (a profile
 * with that id and no `inherits`); when no root carrier exists, it is the suffix-stripped `name`
 * of the shortest carrier.
 */
export async function listFilaments(cfg: ServerConfig): Promise<{ id: string; name: string }[]> {
  const userDir = join(cfg.userDataDir, "user", cfg.userId, "filament");
  const profilesDir = join(cfg.installDir, "resources", "profiles");

  const candidates: FilamentCandidate[] = [...(await collectFilamentCandidates(userDir))];
  for (const vendorName of await listVendorDirNames(profilesDir)) {
    candidates.push(...(await collectFilamentCandidates(join(profilesDir, vendorName, "filament"))));
  }

  const byId = new Map<string, FilamentCandidate[]>();
  for (const candidate of candidates) {
    const list = byId.get(candidate.filamentId);
    if (list) list.push(candidate);
    else byId.set(candidate.filamentId, [candidate]);
  }

  const results: { id: string; name: string }[] = [];
  for (const [id, forId] of byId) {
    const root = forId.find((c) => !c.hasInherits);
    const chosen = root ?? forId.reduce((shortest, c) => (c.name.length < shortest.name.length ? c : shortest));
    results.push({ id, name: stripAtSuffix(chosen.name) });
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
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
