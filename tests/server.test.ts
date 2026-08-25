import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config.js";
import { buildServer, warnIfUnconfigured } from "../src/index.js";
import { FsProfileStore } from "../src/profile-store.js";
import type { ToolDeps } from "../src/tools/deps.js";
import type { ServerConfig } from "../src/types.js";
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

describe("bambu-studio-profile-mcp server", () => {
  it("registers exactly the expected tool set", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "compare_profiles",
      "diff_profile",
      "import_profile",
      "init_config",
      "lint_profile",
      "list_filaments",
      "list_parameters",
      "list_profiles",
      "list_vendors",
      "remove_profile",
      "resolve_from_file",
      "resolve_profile",
      "update_profile",
      "write_profile",
    ]);
  });

  // Applies to whatever is registered, so a new tool inherits this gate without editing the test.
  it("gives every registered tool a description and annotations", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} description length`).toBeGreaterThan(80);
      expect(tool.annotations, `${tool.name} annotations`).toBeDefined();
      expect(tool.annotations!.readOnlyHint, `${tool.name} readOnlyHint`).toBeTypeOf("boolean");
      expect(tool.inputSchema, `${tool.name} inputSchema`).toBeDefined();
    }
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

  it("projects resolve_profile settings over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "resolve_profile",
      arguments: {
        kind: "process",
        vendor: "BBL",
        name: "0.20mm Standard @BBL X1C",
        keys: ["layer_height", "no_such_key"],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      settings: { layer_height: "0.2" },
      missingKeys: ["no_such_key"],
    });
    expect(Object.keys((result.structuredContent as { settings: object }).settings)).toEqual(["layer_height"]);
  });

  it("resolves nil columns against a named machine preset over the protocol", async () => {
    const client = await connectedClient();
    const withMachine = await client.callTool({
      name: "resolve_profile",
      arguments: {
        kind: "filament",
        vendor: "BBL",
        name: "Nil Override PLA @BBL X1C",
        machineName: "Bambu Lab X1 Carbon 0.4 nozzle",
      },
    });
    expect(withMachine.isError).toBeFalsy();
    expect(withMachine.structuredContent).toMatchObject({
      settings: { filament_retraction_length: ["1.5", "1.2", "0.8"] },
      nilResolved: { filament_retraction_length: [1, 2] },
    });

    const withoutMachine = await client.callTool({
      name: "resolve_profile",
      arguments: { kind: "filament", vendor: "BBL", name: "Nil Override PLA @BBL X1C" },
    });
    expect(withoutMachine.isError).toBeFalsy();
    expect(withoutMachine.structuredContent).toMatchObject({
      settings: { filament_retraction_length: ["1.5", "nil", "nil"] },
      nilUnresolved: { filament_retraction_length: [1, 2] },
    });
  });

  it("serves the machine kind on the read tools over the protocol", async () => {
    const client = await connectedClient();

    const resolved = await client.callTool({
      name: "resolve_profile",
      arguments: { kind: "machine", vendor: "BBL", name: "Bambu Lab X1 Carbon 0.4 nozzle" },
    });
    expect(resolved.isError).toBeFalsy();
    expect(resolved.structuredContent).toMatchObject({
      kind: "machine",
      settings: {
        printer_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow", "Direct Drive Standard"],
      },
    });

    const listed = await client.callTool({
      name: "list_profiles",
      arguments: { kind: "machine", vendor: "BBL" },
    });
    expect(listed.isError).toBeFalsy();
    expect((listed.structuredContent as { profiles: { name: string }[] }).profiles.map((p) => p.name)).toContain(
      "fdm_machine_common"
    );

    const params = await client.callTool({
      name: "list_parameters",
      arguments: { kind: "machine", search: "printer_extruder_variant" },
    });
    expect(params.isError).toBeFalsy();
    expect(params.structuredContent).toMatchObject({
      kind: "machine",
      parameters: [{ key: "printer_extruder_variant", vector: true }],
    });
  });

  it("rejects the machine kind on every writing tool over the protocol", async () => {
    const client = await connectedClient();
    const calls: { name: string; arguments: Record<string, unknown> }[] = [
      {
        name: "write_profile",
        arguments: {
          kind: "machine",
          vendor: "BBL",
          name: "Nope",
          baseProfile: "fdm_machine_common",
          kvps: { printable_height: "300" },
          outputDir: join(FIXTURES, "unused"),
        },
      },
      {
        name: "update_profile",
        arguments: { kind: "machine", name: "Nope", outputDir: join(FIXTURES, "unused"), set: { printable_height: "300" } },
      },
      {
        name: "import_profile",
        arguments: { kind: "machine", name: "Nope", outputDir: join(FIXTURES, "unused") },
      },
      { name: "remove_profile", arguments: { kind: "machine", name: "Nope" } },
      {
        name: "diff_profile",
        arguments: { kind: "machine", name: "Nope", outputDir: join(FIXTURES, "unused") },
      },
      {
        name: "lint_profile",
        arguments: { kind: "machine", vendor: "BBL", name: "Nope", outputDir: join(FIXTURES, "unused") },
      },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      expect(result.isError, `${call.name} must reject kind machine`).toBe(true);
      const text = (result.content as { text: string }[])[0].text;
      expect(text, `${call.name} must reject kind machine at the schema`).toContain("kind");
      expect(text).toContain("validation");
    }
  });

  it("serves lint_profile end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const tmp = await mkdtemp(join(tmpdir(), "ppm-server-lint-"));
    try {
      await writeFile(
        join(tmp, "Linted.json"),
        JSON.stringify({
          name: "Linted",
          inherits: "0.20mm Standard @BBL X1C",
          wall_loops: "3",
          bogus_key: "1",
        }),
        "utf8"
      );

      const result = await client.callTool({
        name: "lint_profile",
        arguments: { kind: "process", vendor: "BBL", outputDir: tmp, name: "Linted" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        kind: "process",
        name: "Linted",
        path: join(tmp, "Linted.json"),
        clean: false,
        findings: [
          { check: "parent-equal-override", key: "wall_loops", detail: expect.any(String) },
          { check: "unknown-key", key: "bogus_key", detail: expect.any(String) },
        ],
        skipped: [{ check: "column-count", reason: expect.stringContaining("machineName") }],
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("filters list_profiles by source over the protocol", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "list_profiles",
      arguments: { kind: "process", source: "user" },
    });
    expect(result.isError).toBeFalsy();
    const { profiles } = result.structuredContent as { profiles: { source: string }[] };
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.every((p) => p.source === "user")).toBe(true);
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
    expect(received[0]).toMatchObject({ level: "warning", logger: "bambu-studio-profile-mcp" });
    expect((received[0] as { data: string }).data).toContain(".bambu-studio-profile-mcp/config.json");
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

  it("serves import_profile and remove_profile end-to-end over the protocol", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ppm-proto-"));
    try {
      const outDir = join(tmp, "out");
      await mkdir(join(tmp, "userdata", "user", "u1", "process"), { recursive: true });
      await mkdir(outDir, { recursive: true });
      await writeFile(
        join(outDir, "Proto Draft.json"),
        JSON.stringify({ name: "Proto Draft", inherits: "fdm_process_common", layer_height: "0.16" }),
        "utf8"
      );
      class ProtoConfig extends ConfigManager {
        constructor() {
          super(join(FIXTURES, "does-not-exist.json"));
        }
        override async load(): Promise<ServerConfig | null> {
          return { installDir: join(FIXTURES, "install"), userDataDir: join(tmp, "userdata"), userId: "u1" };
        }
      }
      const server = buildServer({
        config: new ProtoConfig(),
        storeFactory: (cfg) => new FsProfileStore(cfg),
        schemaDir: join(FIXTURES, "schema"),
        detectPaths: async () => ({}),
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const imported = await client.callTool({
        name: "import_profile",
        arguments: { kind: "process", vendor: "BBL", outputDir: outDir, name: "Proto Draft" },
      });
      expect(imported.isError).toBeFalsy();
      expect(imported.structuredContent).toMatchObject({ kind: "process", overwritten: false });

      const diffed = await client.callTool({
        name: "diff_profile",
        arguments: { kind: "process", name: "Proto Draft", outputDir: outDir },
      });
      expect(diffed.isError).toBeFalsy();
      expect(diffed.structuredContent).toMatchObject({
        identical: true,
        newer: expect.stringMatching(/^(source|installed|same)$/),
      });

      const resolvedFromFile = await client.callTool({
        name: "resolve_from_file",
        arguments: { kind: "process", vendor: "BBL", outputDir: outDir, name: "Proto Draft" },
      });
      expect(resolvedFromFile.isError).toBeFalsy();
      expect(resolvedFromFile.structuredContent).toMatchObject({
        kind: "process",
        name: "Proto Draft",
        chain: ["fdm_process_common", "Proto Draft"],
        settings: { layer_height: "0.16", wall_loops: "2" },
        path: join(outDir, "Proto Draft.json"),
      });

      const removed = await client.callTool({
        name: "remove_profile",
        arguments: { kind: "process", name: "Proto Draft" },
      });
      expect(removed.isError).toBeFalsy();
      expect(removed.structuredContent).toMatchObject({ cloudRecord: false, removedInfo: expect.any(String) });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
  it("serves compare_profiles end-to-end over the protocol", async () => {
    const client = await connectedClient();
    const resolved = await client.callTool({
      name: "compare_profiles",
      arguments: {
        kind: "process",
        vendor: "BBL",
        left: { preset: "0.20mm Standard @BBL X1C" },
        right: { preset: "My Custom Draft" },
      },
    });
    expect(resolved.isError).toBeFalsy();
    expect(resolved.structuredContent).toMatchObject({
      mode: "resolved",
      left: { label: "0.20mm Standard @BBL X1C" },
      right: { label: "My Custom Draft" },
      identical: false,
      changed: [{ key: "layer_height", left: "0.2", right: "0.28" }],
    });

    const raw = await client.callTool({
      name: "compare_profiles",
      arguments: {
        kind: "machine",
        vendor: "BBL",
        mode: "raw",
        left: { preset: "Bambu Lab X1 Carbon 0.4 nozzle" },
        right: { preset: "fdm_machine_common" },
      },
    });
    expect(raw.isError).toBeFalsy();
    expect(raw.structuredContent).toMatchObject({ mode: "raw", identical: false });
  });
});
