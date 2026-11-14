import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { GenerateBody } from "@sofa/shared";
import type { WidgetDef } from "@sofa/widgets";
import WebSocket from "ws";
import * as Y from "yjs";
import { z } from "zod";
import type { Config } from "../config";
import { buildServer, type ServerParts, type SofaServer } from "../server";
import type { AiService } from "../types";

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sofa-test-"));
}

export function testConfig(
  dataDir: string,
  webDir = path.join(dataDir, "no-web"),
  spaceTtlHours = 0,
): Config {
  return {
    port: 0,
    dataDir,
    publicUrl: null,
    webDir,
    spaceTtlHours,
    trustProxyHops: 0,
    demo: false,
    ai: { provider: "none", model: "", apiKey: null, baseUrl: null },
  };
}

export type FakeAi = AiService & { calls: { spaceId: string; body: GenerateBody }[] };

export function fakeAi(): FakeAi {
  const calls: FakeAi["calls"] = [];
  return {
    calls,
    enabled: true,
    info: () => ({ provider: "fake", model: "fake-1" }),
    async generate(spaceId, body) {
      calls.push({ spaceId, body });
      return { messageId: `msg-${calls.length}` };
    },
  };
}

export const pollDef: WidgetDef<{ question: string; options: string[] }> = {
  type: "poll",
  title: "Poll",
  description: "Vote on a few options.",
  guide: "test",
  configSchema: z.object({ question: z.string(), options: z.array(z.string()) }),
  starter: {
    title: "Quick poll",
    description: "Pick one",
    config: { question: "Where?", options: ["A", "B"] },
    initialState: { "note:1": "hello" },
  },
  keywords: ["poll"],
};

export type Running = {
  server: SofaServer;
  base: string;
  port: number;
  ai: FakeAi;
  dataDir: string;
};

export async function startServer(
  dataDir = tempDir(),
  parts: Partial<ServerParts> = {},
  webDir?: string,
): Promise<Running> {
  const ai = fakeAi();
  const server = buildServer(testConfig(dataDir, webDir), {
    createAi: () => ai,
    widgets: [pollDef],
    collabDebounceMs: 100,
    ...parts,
  });
  const port = await server.listen(0, "127.0.0.1");
  return { server, base: `http://127.0.0.1:${port}`, port, ai, dataDir };
}

export async function postJson(url: string, body: unknown, token?: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function createSpace(base: string, title = "Trip", password?: string) {
  const res = await postJson(`${base}/api/spaces`, { title, password });
  if (res.status !== 201) throw new Error(`create space failed: ${res.status}`);
  return (await res.json()) as {
    id: string;
    title: string;
    createdAt: number;
    locked: boolean;
    token?: string;
  };
}

export type Client = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** resolves "synced" or the reason of an authentication failure */
  ready: Promise<string>;
  destroy(): void;
};

export function connect(port: number, spaceId: string, token?: string): Client {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}/collab`,
    WebSocketPolyfill: WebSocket,
    maxAttempts: 1,
  });
  let settle: (value: string) => void = () => {};
  const ready = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: spaceId,
    document: doc,
    token: token ?? null,
    onSynced: () => settle("synced"),
    onAuthenticationFailed: ({ reason }) => settle(`denied:${reason}`),
  });
  provider.attach();
  return {
    doc,
    provider,
    ready,
    destroy() {
      provider.destroy();
      socket.destroy();
      doc.destroy();
    },
  };
}

export async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
