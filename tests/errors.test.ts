import { describe, expect, it } from "vitest";
import {
  CircularInheritanceError,
  ConfigMissingError,
  ProfileNotFoundError,
  SchemaValidationError,
  VendorNotFoundError,
} from "../src/errors.js";

describe("errors", () => {
  it("SchemaValidationError carries all violations", () => {
    const err = new SchemaValidationError([
      { key: "layer_height", reason: "out of range" },
      { key: "bogus_key", reason: "unknown key" },
    ]);
    expect(err.violations).toHaveLength(2);
    expect(err.message).toContain("layer_height");
    expect(err.message).toContain("bogus_key");
  });

  it("ConfigMissingError names init_config as the fix", () => {
    expect(new ConfigMissingError().message).toContain("init_config");
  });

  it("all error classes are instanceof Error with a name", () => {
    for (const err of [
      new VendorNotFoundError("BBL"),
      new ProfileNotFoundError("process", "X"),
      new CircularInheritanceError(["a", "b", "a"]),
    ]) {
      expect(err).toBeInstanceOf(Error);
      expect(err.name).not.toBe("Error");
    }
  });
});
