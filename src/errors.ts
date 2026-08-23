import type { Violation } from "./types.js";
import { strings } from "./strings.js";

export class VendorNotFoundError extends Error {
  constructor(vendor: string) {
    super(strings.errors.vendorNotFound(vendor));
    this.name = "VendorNotFoundError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(kind: string, name: string) {
    super(strings.errors.profileNotFound(kind, name));
    this.name = "ProfileNotFoundError";
  }
}

export class CircularInheritanceError extends Error {
  constructor(chain: string[]) {
    super(strings.errors.circularInheritance(chain));
    this.name = "CircularInheritanceError";
  }
}

export class SchemaValidationError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(strings.errors.schemaValidation(violations));
    this.name = "SchemaValidationError";
    this.violations = violations;
  }
}

export class ConfigMissingError extends Error {
  constructor() {
    super(strings.errors.configMissing);
    this.name = "ConfigMissingError";
  }
}
