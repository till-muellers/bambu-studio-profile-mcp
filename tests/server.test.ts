import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { buildServer, warnIfUnconfigured } from "../src/index.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import { handleWrite } from "../src/tools/write.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

class FixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return { installDir: join(FIXTURES, "install"), userDataDir: join(FIXTURES, "userdata"), userId: "1234567890" };
  }
}

class UnconfiguredFixtureConfig extends ConfigManager {
  constructor() {
    super(join(FIXTURES, "does-not-exist.json"));
  }
  override async load() {
    return null;
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

function unconfiguredFixtureDeps(): ToolDeps {
  return { ...fixtureDeps(), config: new UnconfiguredFixtureConfig() };
}

async function connectedClient(deps: ToolDeps = fixtureDeps()): Promise<Client> {
  const { client } = await connectedClientAndServer(deps);
  return client;
}

async function connectedClientAndServer(
  deps: ToolDeps = fixtureDeps()
): Promise<{ client: Client; server: ReturnType<typeof buildServer> }> {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("printing-profile-mcp server", () => {
  it("exposes exactly the nine tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "import_profile",
      "init_config",
      "list_filaments",
      "list_parameters",
      "list_profiles",
      "list_vendors",
      "resolve_profile",
      "update_profile",
      "write_profile",
    ]);
  });

  it("serves list_profiles end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "list_profiles",
      arguments: { kind: "process", search: "Standard" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "process",
      profiles: [{ name: "0.20mm Standard @BBL X1C", source: "system", vendor: "BBL" }],
    });
  });

  it("serves list_vendors end-to-end over the protocol with no arguments", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_vendors", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      vendors: [
        { id: "BBL", name: "Bambulab" },
        { id: "OTHERCO", name: "OTHERCO" },
      ],
    });
  });

  it("serves list_parameters end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "list_parameters",
      arguments: { kind: "process", search: "layer_height" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "process",
      parameters: [{ key: "layer_height", type: "float" }],
    });
  });

  it("serves resolve_profile end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_profile",
      arguments: { kind: "process", vendor: "BBL", name: "0.20mm Standard @BBL X1C" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "process",
      chain: ["fdm_process_common", "0.20mm Standard @BBL X1C"],
    });
  });

  it("serves update_profile end-to-end over the protocol", async () => {
    const outDir = join(await mkdtemp(join(tmpdir(), "ppm-server-update-")), "out");
    try {
      await handleWrite(fixtureDeps(), "process", {
        vendor: "BBL",
        name: "Server Update Test",
        baseProfile: "fdm_process_common",
        kvps: { layer_height: "0.2", wall_loops: "2" },
        outputDir: outDir,
      });

      const client = await connectedClient();
      const result = await client.callTool({
        name: "update_profile",
        arguments: {
          kind: "process",
          name: "Server Update Test",
          outputDir: outDir,
          set: { layer_height: "0.16" },
          remove: ["wall_loops"],
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        name: "Server Update Test",
        kind: "process",
        set: ["layer_height"],
        removed: ["wall_loops"],
        overrides: { layer_height: "0.16" },
      });

      const onDisk = JSON.parse(await readFile(join(outDir, "Server Update Test.json"), "utf8"));
      expect(onDisk).toEqual({
        name: "Server Update Test",
        inherits: "fdm_process_common",
        layer_height: "0.16",
      });
    } finally {
      await rm(join(outDir, ".."), { recursive: true, force: true });
    }
  });

  it("returns an isError result (not a protocol error) for a missing profile", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_profile",
      arguments: { kind: "process", vendor: "BBL", name: "ghost" },
    });
    expect(result.isError).toBe(true);
  });

  it("still serves tool calls (as isError) when unconfigured", async () => {
    const client = await connectedClient(unconfiguredFixtureDeps());
    const result = await client.callTool({
      name: "resolve_profile",
      arguments: { kind: "process", vendor: "BBL", name: "0.20mm Standard @BBL X1C" },
    });
    expect(result.isError).toBe(true);
  });

  it("sends an MCP logging warning notification via warnIfUnconfigured when unconfigured", async () => {
    const { client, server } = await connectedClientAndServer(unconfiguredFixtureDeps());
    const received: unknown[] = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      received.push(notification.params);
    });

    await warnIfUnconfigured(server, unconfiguredFixtureDeps());
    // Let the notification round-trip over the in-memory transport.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ level: "warning", logger: "printing-profile-mcp" });
    expect((received[0] as { data: string }).data).toContain(".printing-profile-mcp/config.json");
    expect((received[0] as { data: string }).data).toContain("init_config");
  });

  it("does not send a notification via warnIfUnconfigured when already configured", async () => {
    const { client, server } = await connectedClientAndServer(fixtureDeps());
    const received: unknown[] = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      received.push(notification.params);
    });

    await warnIfUnconfigured(server, fixtureDeps());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(0);
  });
});
