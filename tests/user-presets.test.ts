import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STUDIO_RESTART_NOTE,
  formatInfoSidecar,
  parseSettingId,
  userPresetPaths,
} from "../src/user-presets.js";

const CFG = { installDir: "D:/inst", userDataDir: "D:/data", userId: "1234567890" };

describe("userPresetPaths", () => {
  it("builds the json and info pair inside user/<userId>/<kind>", () => {
    const { jsonPath, infoPath } = userPresetPaths(CFG, "process", "My Draft");
    expect(jsonPath).toBe(join("D:/data", "user", "1234567890", "process", "My Draft.json"));
    expect(infoPath).toBe(join("D:/data", "user", "1234567890", "process", "My Draft.info"));
  });

  it("allows a name with spaces and special characters", () => {
    const { jsonPath } = userPresetPaths(CFG, "process", "0.20mm Standard @BBL X1C");
    expect(jsonPath).toBe(
      join("D:/data", "user", "1234567890", "process", "0.20mm Standard @BBL X1C.json")
    );
  });

  it.each([
    ["../evil"],
    ["..\\evil"],
    ["sub/x"],
    ["sub\\x"],
    [".."],
  ])("rejects a traversal name %s", (name) => {
    expect(() => userPresetPaths(CFG, "process", name)).toThrow(/path|separator|plain filename/i);
  });
});

describe("formatInfoSidecar", () => {
  it("emits exactly the five fields in order with CRLF endings and empty ids", () => {
    expect(formatInfoSidecar(1784668006)).toBe(
      "sync_info = \r\n" +
        "user_id = \r\n" +
        "setting_id = \r\n" +
        "base_id = \r\n" +
        "updated_time = 1784668006\r\n"
    );
  });
});

describe("parseSettingId", () => {
  it("extracts a populated setting_id", () => {
    const info =
      "sync_info = \r\nuser_id = 1234567890\r\nsetting_id = PFUS00000000000000\r\nbase_id = GFSG00_14\r\nupdated_time = 1784668006\r\n";
    expect(parseSettingId(info)).toBe("PFUS00000000000000");
  });

  it("returns empty string for an empty or missing setting_id line", () => {
    expect(parseSettingId("sync_info = \r\nsetting_id = \r\nupdated_time = 1\r\n")).toBe("");
    expect(parseSettingId("sync_info = \r\nupdated_time = 1\r\n")).toBe("");
  });
});

describe("STUDIO_RESTART_NOTE", () => {
  it("mentions the restart requirement", () => {
    expect(STUDIO_RESTART_NOTE).toContain("restart");
  });
});
