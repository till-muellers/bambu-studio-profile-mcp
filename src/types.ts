export type ProfileKind = "process" | "filament";

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
  findProfile(kind: ProfileKind, vendor: string, name: string): Promise<ProfileHit | null>;
}

export interface ResolvedProfile {
  vendor: string;
  name: string;
  kind: ProfileKind;
  chain: string[];
  settings: Record<string, unknown>;
  /** Present when a key projection was requested: the requested keys the resolved settings lack. */
  missingKeys?: string[];
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
