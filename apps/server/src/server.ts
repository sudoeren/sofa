import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import type { WidgetDef } from "@sofra/widgets";
import { createApp, type RateLimits } from "./app";
import { type Collab, createCollab } from "./collab";
import type { Config } from "./config";
import { type Db, loadSecret, openDb } from "./db";
import { createFiles, type Files } from "./files";
import { createLinkPreviewer, type LinkPreviewer } from "./links";
import type { AiDeps, AiService, SpaceDocs } from "./types";

export type ServerParts = {
  /** builds the AI service once documents and files are available */
  createAi: (config: Config, deps: AiDeps) => AiService;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
  widgets: WidgetDef<any>[];
  preview?: LinkPreviewer;
  rateLimits?: Partial<RateLimits>;
  /** delay before a changed document is written to the database */
  collabDebounceMs?: number;
};

export type SofraServer = {
  config: Config;
  db: Db;
  docs: SpaceDocs;
  files: Files;
  ai: AiService;
  http: HttpServer;
  /** Start listening. Port 0 picks a free port; the resolved value is the real one. */
  listen(port?: number, host?: string): Promise<number>;
  /** Stop accepting connections, write every open document and close the database. */
  close(): Promise<void>;
};

/** Wire storage, collab, files, AI and the REST app onto one HTTP server. */
export function buildServer(config: Config, parts: ServerParts): SofraServer {
  const db = openDb(config.dataDir);
  const secret = loadSecret(config.dataDir);
  const collab: Collab = createCollab({ db, secret, debounceMs: parts.collabDebounceMs });
  const files = createFiles(db, config.dataDir);
  const ai = parts.createAi(config, { docs: collab.docs, files });
  const app = createApp({
    config,
    db,
    secret,
    docs: collab.docs,
    files,
    ai,
    widgets: parts.widgets,
    preview: parts.preview ?? createLinkPreviewer(),
    rateLimits: parts.rateLimits,
  });

  const http = createHttpServer(getRequestListener(app.fetch));
  // Slow or stalled clients must not hold sockets open forever.
  http.requestTimeout = 60_000;
  http.headersTimeout = 20_000;
  collab.attach(http);

  let closing: Promise<void> | null = null;

  return {
    config,
    db,
    docs: collab.docs,
    files,
    ai,
    http,
    listen(port = config.port, host) {
      return new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          resolve((http.address() as AddressInfo).port);
        });
      });
    },
    close() {
      closing ??= (async () => {
        const stopped = new Promise<void>((resolve) => {
          if (http.listening) http.close(() => resolve());
          else resolve();
        });
        await collab.close();
        http.closeAllConnections();
        await stopped;
        db.close();
      })();
      return closing;
    },
  };
}
