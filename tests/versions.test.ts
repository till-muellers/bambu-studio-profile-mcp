import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateLoadability,
  normalizeVersion,
  readVendorVersion,
  FALLBACK_PRESET_VERSION,
} from "../src/versions.js";
import type { ServerConfig } from "../src/types.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const CFG: ServerConfig = {
  installDir: join(FIXTURES, "install"),
  userDataDir: join(FIXTURES, "userdata"),
  userId: "1234567890",
};

describe("normalizeVersion", () => {
  it("strips leading zeros per component", () => {
    expect(normalizeVersion("02.08.00.04")).toBe("2.8.0.4");
  });

  it("leaves an already normalized version alone", () => {
    expect(normalizeVersion("2.7.0.8")).toBe("2.7.0.8");
  });

  it("accepts three components", () => {
    expect(normalizeVersion("0.0.0")).toBe("0.0.0");
  });

  it("rejects an empty string, a non-numeric component, and a non-string", () => {
    expect(normalizeVersion("")).toBeUndefined();
    expect(normalizeVersion("2.8.x")).toBeUndefined();
    expect(normalizeVersion("1.2")).toBeUndefined();
    expect(normalizeVersion(undefined)).toBeUndefined();
    expect(normalizeVersion(2)).toBeUndefined();
  });
});

describe("readVendorVersion", () => {
  it("reads and normalizes the vendor index version", async () => {
    expect(await readVendorVersion(CFG, "BBL")).toBe("2.8.0.4");
  });

  it("returns undefined for a vendor index that does not exist", async () => {
    expect(await readVendorVersion(CFG, "NOSUCHVENDOR")).toBeUndefined();
  });

  it("returns undefined for a vendor index carrying no version", async () => {
    expect(await readVendorVersion(CFG, "OTHERCO")).toBeUndefined();
  });
});

describe("evaluateLoadability", () => {
  it("rejects a missing version and says the app version was not consulted", () => {
    const result = evaluateLoadability(undefined, "02.08.02.60");
    expect(result.ok).toBe(false);
    expect(result.appVersionChecked).toBe(false);
    expect(result.reason).toBeTypeOf("string");
  });

  it("rejects an unparseable version", () => {
    expect(evaluateLoadability("", "02.08.02.60").ok).toBe(false);
  });

  it("accepts a version whose major matches the application", () => {
    expect(evaluateLoadability("2.8.0.4", "02.08.02.60")).toEqual({
      ok: true,
      appVersionChecked: true,
    });
  });

  it("rejects a version a major ahead of the application", () => {
    const result = evaluateLoadability("3.0.0.0", "02.08.02.60");
    expect(result.ok).toBe(false);
    expect(result.appVersionChecked).toBe(true);
  });

  it("accepts the fallback version against any application version", () => {
    expect(evaluateLoadability(FALLBACK_PRESET_VERSION, "02.08.02.60").ok).toBe(true);
  });

  it("skips the major condition when the application version is unknown", () => {
    expect(evaluateLoadability("99.0.0.0", undefined)).toEqual({
      ok: true,
      appVersionChecked: false,
    });
  });
});
