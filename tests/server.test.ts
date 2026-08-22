import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { buildServer } from "../src/index.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class FixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" };
  }
}

function fixtureDeps(): ToolDeps {
  return {
    config: new FixtureConfig(),
    storeFactory: (cfg) => new FsProfileStore(cfg),
    schemaDir: join(FIXTURES, "schema"),
    detectPaths: async () => ({}),
  };
}

async function connectedClient(): Promise<Client> {
  const server = buildServer(fixtureDeps());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("printing-profile-mcp server", () => {
  it("exposes exactly the five spec tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "init_config",
      "resolve_filament_profile",
      "resolve_process_profile",
      "write_filament_profile",
      "write_process_profile",
    ]);
  });

  it("serves resolve_process_profile end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_process_profile",
      arguments: { vendor: "BBL", name: "0.20mm Standard @BBL X1C" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "process",
      chain: ["fdm_process_common", "0.20mm Standard @BBL X1C"],
    });
  });

  it("returns an isError result (not a protocol error) for a missing profile", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_process_profile",
      arguments: { vendor: "BBL", name: "ghost" },
    });
    expect(result.isError).toBe(true);
  });
});
