/**
 * Preset kinds this server reads. Machine presets describe the printer itself — their
 * printer_extruder_variant fixes how many columns every per-extruder vector option carries.
 */
export type ReadableProfileKind = "process" | "filament" | "machine";

/**
 * Preset kinds this server authors, installs, and removes. Bambu Studio owns machine presets:
 * it writes them from its Printer settings, and values changed there may never reach a file at all.
 */
export type WritableProfileKind = "process" | "filament";

export interface ServerConfig {
  installDir: string;
  userDataDir: string;
  /** The user/<userId> directory resolution reads. */
  userId: string;
}

/** A profile JSON file as read from disk. */
export interface RawProfile {
  name: string;
  inherits?: string;
  [key: string]: unknown;
}

export interface ProfileHit {
  profile: RawProfile;
  source: "user" | "system";
  path: string;
}

/** Read-only lookup over the system + user preset stores. */
export interface ProfileStore {
  /** User store (user/<userId>/<kind>) first, then system store under the given vendor. Null if absent in both. */
  findProfile(kind: ReadableProfileKind, vendor: string, name: string): Promise<ProfileHit | null>;
}

export interface ResolvedProfile {
  vendor: string;
  name: string;
  kind: ReadableProfileKind;
  chain: string[];
  settings: Record<string, unknown>;
  /** Present when a key projection was requested: the requested keys the resolved settings lack. */
  missingKeys?: string[];
  /** Key -> vector column indices whose value came from a parent rather than the profile itself. */
  nilResolved?: Record<string, number[]>;
  /** Key -> vector column indices still "nil" because no parent supplied a value at that index. */
  nilUnresolved?: Record<string, number[]>;
}

export type SchemaType = "string" | "int" | "float" | "bool" | "enum" | "percent";

export interface SchemaOption {
  type: SchemaType;
  /** True for per-extruder/per-filament options stored as string arrays; false for bare scalars. */
  vector: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  label?: string;
  description?: string;
  /** Unit the value is expressed in, as Bambu Studio shows it beside the field ("mm", "mm/s", "°C"). */
  unit?: string;
  /** True when Bambu Studio marks this option nullable (def->nullable = true); "nil" is then a legal element/value. */
  nullable?: boolean;
}

export type ProfileSchema = Record<string, SchemaOption>;

export interface Violation {
  key: string;
  reason: string;
}
