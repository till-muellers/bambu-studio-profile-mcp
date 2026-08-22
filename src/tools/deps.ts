import type { ConfigManager, DetectedPaths } from "../config.js";
import type { ProfileStore, ServerConfig } from "../types.js";

export interface ToolDeps {
  config: ConfigManager;
  storeFactory: (cfg: ServerConfig) => ProfileStore;
  /** Directory containing process.schema.json and filament.schema.json. */
  schemaDir: string;
  /** Best-effort path auto-detection; init_config uses it to fill omitted args. */
  detectPaths: () => Promise<DetectedPaths>;
}

export function toToolError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
