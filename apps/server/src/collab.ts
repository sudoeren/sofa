import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { COLLAB_PATH, isSpaceId, metaMap } from "@sofra/shared";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { verifySpaceToken } from "./auth";
import type { Db, SpaceRow } from "./db";
import type { SpaceDocs } from "./types";

export type Collab = {
  docs: SpaceDocs;
  /** Route WebSocket upgrades at COLLAB_PATH to the collab server; refuse all others. */
  attach(server: HttpServer): void;
  /** Persist every loaded document and close all sockets. */
  close(): Promise<void>;
};

export type CollabOptions = {
  db: Db;
  secret: Buffer;
  /** delay before a changed document is written to the database */
  debounceMs?: number;
};

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const PING_INTERVAL_MS = 20_000;

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Fill in the meta map of a document from its space row. Returns true when it changed. */
function initMeta(doc: Y.Doc, space: SpaceRow): boolean {
  const meta = metaMap(doc);
  const locked = space.passwordHash !== null;
  let changed = false;
  doc.transact(() => {
    if (typeof meta.get("title") !== "string") {
      meta.set("title", space.title);
      changed = true;
    }
    if (typeof meta.get("createdAt") !== "number") {
      meta.set("createdAt", space.createdAt);
      changed = true;
    }
    if (meta.get("locked") !== locked) {
      meta.set("locked", locked);
      changed = true;
    }
  });
  return changed;
}

export function createCollab(options: CollabOptions): Collab {
  const { db, secret } = options;
  let closed = false;

  function persist(spaceId: string, doc: Y.Doc) {
    if (closed || !db.getSpace(spaceId)) return;
    db.saveDoc(spaceId, Y.encodeStateAsUpdate(doc));
  }

  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: 10_000,
    timeout: 60_000,
    // Rejections carry no message on purpose: Hocuspocus logs every hook error that has one.
    async onAuthenticate({ documentName, token }) {
      const space = isSpaceId(documentName) ? db.getSpace(documentName) : null;
      if (!space) throw { reason: "space-not-found" };
      if (space.passwordHash !== null && !verifySpaceToken(secret, space.id, token)) {
        throw { reason: "permission-denied" };
      }
    },
    async onLoadDocument({ documentName, document }) {
      const space = isSpaceId(documentName) ? db.getSpace(documentName) : null;
      if (!space) throw { reason: "space-not-found" };
      const stored = db.loadDoc(space.id);
      if (stored) Y.applyUpdate(document, stored);
      // Updates applied while loading do not trigger the store hook, so write them here.
      if (initMeta(document, space)) persist(space.id, document);
    },
    async onStoreDocument({ documentName, document }) {
      persist(documentName, document);
    },
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const webRequest = new Request(`http://localhost${request.url ?? COLLAB_PATH}`, { headers });
    const connection = hocuspocus.handleConnection(socket, webRequest);
    socket.on("message", (data) => connection.handleMessage(toBytes(data)));
    socket.on("pong", () => connection.touch());
    socket.on("close", (code, reason) =>
      connection.handleClose({ code, reason: reason.toString() }),
    );
    socket.on("error", () => socket.terminate());
  });

  // Hocuspocus drops connections that stay silent for `timeout`; pongs count as activity.
  const pingTimer = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }, PING_INTERVAL_MS);
  pingTimer.unref();

  function onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    let pathname = "";
    try {
      pathname = new URL(request.url ?? "", "http://localhost").pathname;
    } catch {
      pathname = "";
    }
    if (closed || (pathname !== COLLAB_PATH && pathname !== `${COLLAB_PATH}/`)) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  }

  function requireSpace(spaceId: string): SpaceRow {
    const space = isSpaceId(spaceId) ? db.getSpace(spaceId) : null;
    if (!space || closed) throw new Error("space not found");
    return space;
  }

  const docs: SpaceDocs = {
    async transact<T>(spaceId: string, fn: (doc: Y.Doc) => T): Promise<T> {
      requireSpace(spaceId);
      const connection = await hocuspocus.openDirectConnection(spaceId);
      try {
        let result: T | undefined;
        await connection.transact((doc) => {
          result = fn(doc);
        });
        return result as T;
      } finally {
        // Keep the document warm and let the debounced store pick the change up, so a
        // stream of small writes does not rewrite the whole document every time.
        await connection.disconnect({ unloadImmediately: false });
      }
    },
    async read<T>(spaceId: string, fn: (doc: Y.Doc) => T): Promise<T> {
      const space = requireSpace(spaceId);
      const loading = hocuspocus.loadingDocuments.get(spaceId);
      const live = loading ? await loading : hocuspocus.documents.get(spaceId);
      if (live) return fn(live);
      // Nobody has the space open: read a throwaway copy instead of loading it.
      const doc = new Y.Doc();
      try {
        const stored = db.loadDoc(spaceId);
        if (stored) Y.applyUpdate(doc, stored);
        initMeta(doc, space);
        return fn(doc);
      } finally {
        doc.destroy();
      }
    },
  };

  return {
    docs,
    attach(server) {
      server.on("upgrade", onUpgrade);
    },
    async close() {
      if (closed) return;
      for (const [name, doc] of hocuspocus.documents) persist(name, doc);
      closed = true;
      clearInterval(pingTimer);
      // Runs the pending debounced stores now (no-ops after the write above) so their
      // timers do not keep the process alive.
      hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
