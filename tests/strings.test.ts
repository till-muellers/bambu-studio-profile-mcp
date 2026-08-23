import { describe, expect, it } from "vitest";
import { strings } from "../src/strings.js";

describe("strings module", () => {
  it("exposes the top-level groups", () => {
    for (const group of ["tools", "errors", "violations", "warnings", "messages", "formats"] as const) {
      expect(strings[group]).toBeTypeOf("object");
    }
  });

  it("interpolates parameterized messages", () => {
    expect(strings.errors.vendorNotFound("BBL")).toContain("BBL");
    expect(strings.errors.profileNotFound("process", "X")).toContain("X");
    expect(strings.errors.circularInheritance(["a", "b", "a"])).toContain("a");
    expect(strings.violations.element(2, "bad")).toContain("2");
    expect(strings.violations.element(2, "bad")).toContain("bad");
    expect(strings.messages.userIdNotDetected("C:\\x\\BambuStudio.conf")).toContain("BambuStudio.conf");
    expect(strings.formats.toolError("boom")).toBe("Error: boom");
  });

  it("keeps ConfigMissingError guidance intact", () => {
    expect(strings.errors.configMissing).toContain("init_config");
  });

  it("exposes the import/remove tool strings", () => {
    expect(strings.tools.importProfile.title).toBe("Import profile");
    expect(strings.tools.removeProfile.title).toBe("Remove profile");
    expect(strings.messages.invalidProfileName("a/b")).toContain("a/b");
    expect(strings.messages.removeStraySidecar("j.json", "j.info")).toContain("j.info");
  });
});
