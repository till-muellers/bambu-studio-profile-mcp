import type { Violation } from "./types.js";

export class VendorNotFoundError extends Error {
  constructor(vendor: string) {
    super(`Vendor '${vendor}' not found under resources/profiles.`);
    this.name = "VendorNotFoundError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(kind: string, name: string) {
    super(`${kind} profile '${name}' not found in user or system presets.`);
    this.name = "ProfileNotFoundError";
  }
}

export class CircularInheritanceError extends Error {
  constructor(chain: string[]) {
    super(`Circular inherits chain: ${chain.join(" -> ")}`);
    this.name = "CircularInheritanceError";
  }
}

export class SchemaValidationError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(
      `Schema validation failed:\n` +
        violations.map((v) => `- ${v.key}: ${v.reason}`).join("\n")
    );
    this.name = "SchemaValidationError";
    this.violations = violations;
  }
}

export class ConfigMissingError extends Error {
  constructor() {
    super(
      "No configuration found for this project (.printing-profile-mcp/config.json). Call the init_config tool — a plain call with no arguments usually " +
        "suffices, since installDir, userDataDir, and userId (from BambuStudio.conf's app.preset_folder) " +
        "are all auto-detected. Arguments exist as overrides, e.g. to target a specific userId."
    );
    this.name = "ConfigMissingError";
  }
}
