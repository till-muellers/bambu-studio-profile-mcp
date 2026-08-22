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
      "config.json does not exist yet. Call the init_config tool with your userId " +
        "(the user/<id> directory in the Bambu Studio user-data folder); installDir " +
        "and userDataDir are auto-detected if omitted."
    );
    this.name = "ConfigMissingError";
  }
}
