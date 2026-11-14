import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WIDGET_DEFS } from "@sofa/widgets";
import { createAiService } from "./ai/index";
import { type Config, loadConfig } from "./config";
import { buildServer, type ServerParts, type SofaServer } from "./server";

export type { ServerParts, SofaServer } from "./server";

/** The production wiring; tests pass overrides (a fake AI service, widget list, limits). */
export function createServer(config: Config, overrides: Partial<ServerParts> = {}): SofaServer {
  return buildServer(config, { createAi: createAiService, widgets: WIDGET_DEFS, ...overrides });
}

async function main() {
  const config = loadConfig();
  const server = createServer(config);
  const port = await server.listen();
  const info = server.ai.enabled ? server.ai.info() : null;
  const aiLabel = info ? `${info.provider} (${info.model})` : "templates only";
  const ttl = config.spaceTtlHours > 0 ? `, spaces expire after ${config.spaceTtlHours} h` : "";
  console.log(`[sofa] listening on port ${port}, data dir ${config.dataDir}, AI: ${aiLabel}${ttl}`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[sofa] ${signal} received, saving documents`);
    // If something hangs, exit anyway; documents were written first.
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close().then(
      () => process.exit(0),
      (error) => {
        console.error("[sofa] shutdown failed:", error instanceof Error ? error.message : error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error) => {
    console.error("[sofa] failed to start:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
