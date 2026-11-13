import fs from "node:fs";
import path from "node:path";
import { listTools, metaMap, putTool } from "@sofra/shared";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { type Client, type Running, connect, createSpace, postJson, startServer, waitFor } from "./helpers";

let running: Running[] = [];
let clients: Client[] = [];

async function start(dataDir?: string, parts = {}) {
  const s = await startServer(dataDir, parts);
  running.push(s);
  return s;
}

function join(port: number, spaceId: string, token?: string) {
  const client = connect(port, spaceId, token);
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients) client.destroy();
  clients = [];
  for (const s of running) await s.server.close();
  running = [];
});

describe("collab", () => {
  it("syncs two clients and initializes meta", async () => {
    const s = await start();
    const space = await createSpace(s.base, "Dinner");
    const a = join(s.port, space.id);
    const b = join(s.port, space.id);
    expect(await a.ready).toBe("synced");
    expect(await b.ready).toBe("synced");

    expect(metaMap(a.doc).toJSON()).toEqual({ title: "Dinner", createdAt: space.createdAt, locked: false });

    a.doc.getMap("scratch").set("from", "a");
    await waitFor(() => b.doc.getMap("scratch").get("from") === "a");
    b.doc.getArray("list").push(["b1"]);
    await waitFor(() => a.doc.getArray("list").length === 1);
    expect(a.doc.getArray("list").toArray()).toEqual(["b1"]);
  });

  it("rejects unknown and malformed space ids on the socket", async () => {
    const s = await start();
    const unknown = join(s.port, "z".repeat(21));
    expect(await unknown.ready).toBe("denied:space-not-found");
    const malformed = join(s.port, "../etc");
    expect(await malformed.ready).toBe("denied:space-not-found");
    expect(fs.existsSync(path.join(s.dataDir, "sofra.db"))).toBe(true);
    expect(s.server.db.loadDoc("z".repeat(21))).toBeNull();
  });

  it("only upgrades at the collab path", async () => {
    const s = await start();
    const outcome = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${s.port}/api/config`);
      socket.on("open", () => resolve("open"));
      socket.on("unexpected-response", (_req, res) => resolve(`status:${res.statusCode}`));
      socket.on("error", () => resolve("error"));
    });
    expect(outcome).toBe("status:404");
  });

  it("delivers server side writes to a connected client and keeps them across a restart", async () => {
    const first = await start();
    const space = await createSpace(first.base, "Trip");
    const client = join(first.port, space.id);
    expect(await client.ready).toBe("synced");

    const returned = await first.server.docs.transact(space.id, (doc) => {
      doc.getMap("scratch").set("server", 42);
      return "result";
    });
    expect(returned).toBe("result");
    await waitFor(() => client.doc.getMap("scratch").get("server") === 42);

    client.doc.getMap("scratch").set("client", "kept");
    let seen: unknown;
    while (seen !== "kept") {
      seen = await first.server.docs.read(space.id, (doc) => doc.getMap("scratch").get("client"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    client.destroy();
    clients = [];
    await first.server.close();
    running = [];

    const second = await start(first.dataDir);
    expect((await fetch(`${second.base}/api/spaces/${space.id}`)).status).toBe(200);
    expect(await second.server.docs.read(space.id, (doc) => doc.getMap("scratch").toJSON())).toEqual({
      server: 42,
      client: "kept",
    });
    const again = join(second.port, space.id);
    expect(await again.ready).toBe("synced");
    expect(again.doc.getMap("scratch").toJSON()).toEqual({ server: 42, client: "kept" });
    expect(metaMap(again.doc).get("title")).toBe("Trip");
  });

  it("persists writes made while nobody is connected, also when closed right away", async () => {
    const first = await start();
    const space = await createSpace(first.base);
    await first.server.docs.transact(space.id, (doc) => {
      doc.getMap("scratch").set("offline", true);
    });
    await expect(first.server.docs.transact("y".repeat(21), () => 1)).rejects.toThrow("space not found");
    await expect(first.server.docs.read("y".repeat(21), () => 1)).rejects.toThrow("space not found");
    await expect(
      first.server.docs.transact(space.id, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await first.server.close();
    running = [];

    const second = await start(first.dataDir);
    expect(await second.server.docs.read(space.id, (doc) => doc.getMap("scratch").get("offline"))).toBe(true);
    const late = join(second.port, space.id);
    expect(await late.ready).toBe("synced");
    expect(late.doc.getMap("scratch").get("offline")).toBe(true);
  });

  it("stores after the debounce and unloads idle documents without losing data", async () => {
    const s = await start();
    const space = await createSpace(s.base);
    for (let i = 0; i < 3; i++) {
      await s.server.docs.transact(space.id, (doc) => {
        doc.getArray("list").push([i]);
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await s.server.docs.read(space.id, (doc) => doc.getArray("list").toArray())).toEqual([0, 1, 2]);
    await s.server.docs.transact(space.id, (doc) => {
      doc.getArray("list").push([3]);
    });
    expect(await s.server.docs.read(space.id, (doc) => doc.getArray("list").toArray())).toEqual([0, 1, 2, 3]);
  });
});

describe("locked spaces", () => {
  it("requires the password for a token and the token everywhere else", async () => {
    const s = await start();
    const space = await createSpace(s.base, "Secret", "hunter22");
    expect(space.locked).toBe(true);
    expect(typeof space.token).toBe("string");
    const token = space.token as string;

    const info = await fetch(`${s.base}/api/spaces/${space.id}`);
    expect(info.status).toBe(200);
    const body = (await info.json()) as Record<string, unknown>;
    expect(body.locked).toBe(true);
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toMatch(/scrypt|hash/i);

    const unlockUrl = `${s.base}/api/spaces/${space.id}/unlock`;
    const wrong = await postJson(unlockUrl, { password: "nope" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "Wrong password" });
    expect((await postJson(unlockUrl, {})).status).toBe(400);
    const right = await postJson(unlockUrl, { password: "hunter22" });
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ token });

    const other = await createSpace(s.base, "Other", "hunter22");
    const user = { id: "u1", name: "Ada" };
    const routes: [string, unknown][] = [
      [`${s.base}/api/spaces/${space.id}/generate`, { prompt: "x", user }],
      [`${s.base}/api/spaces/${space.id}/templates/poll`, { user }],
      [`${s.base}/api/spaces/${space.id}/links`, { url: "http://127.0.0.1/" }],
    ];
    for (const [url, payload] of routes) {
      expect((await postJson(url, payload)).status).toBe(401);
      expect((await postJson(url, payload, "garbage")).status).toBe(401);
      expect((await postJson(url, payload, other.token)).status).toBe(401);
      expect((await postJson(url, payload, token)).status).toBeLessThan(300);
    }
    expect(s.ai.calls).toHaveLength(1);

    const form = () => {
      const data = new FormData();
      data.append("file", new File(["secret notes"], "notes.txt", { type: "text/plain" }));
      return data;
    };
    const filesUrl = `${s.base}/api/spaces/${space.id}/files`;
    expect((await fetch(filesUrl, { method: "POST", body: form() })).status).toBe(401);
    const uploaded = await fetch(filesUrl, { method: "POST", body: form(), headers: { Authorization: `Bearer ${token}` } });
    expect(uploaded.status).toBe(201);
    const file = (await uploaded.json()) as { url: string };
    expect((await fetch(`${s.base}${file.url}`)).status).toBe(401);
    expect((await fetch(`${s.base}${file.url}?t=${other.token}`)).status).toBe(401);
    const download = await fetch(`${s.base}${file.url}?t=${token}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("secret notes");
    expect((await fetch(`${s.base}${file.url}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

    const anonymous = join(s.port, space.id);
    expect(await anonymous.ready).toBe("denied:permission-denied");
    const forged = join(s.port, space.id, other.token);
    expect(await forged.ready).toBe("denied:permission-denied");
    const member = join(s.port, space.id, token);
    expect(await member.ready).toBe("synced");
    expect(metaMap(member.doc).get("locked")).toBe(true);
    expect(listTools(member.doc)).toHaveLength(1);
    expect(anonymous.doc.getMap("tools").size).toBe(0);

    await s.server.docs.transact(space.id, (doc) => {
      putTool(doc, { ...listTools(doc)[0]!, id: "second", order: 2 });
    });
    await waitFor(() => listTools(member.doc).length === 2);
    expect(anonymous.doc.getMap("tools").size).toBe(0);
  });

  it("rate limits unlock attempts and has no unlock for open spaces", async () => {
    const s = await start(undefined, { rateLimits: { unlock: { limit: 3, windowMs: 60_000 } } });
    const space = await createSpace(s.base, "Secret", "hunter22");
    const url = `${s.base}/api/spaces/${space.id}/unlock`;
    for (let i = 0; i < 3; i++) expect((await postJson(url, { password: "bad" })).status).toBe(403);
    const blocked = await postJson(url, { password: "hunter22" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toHaveProperty("error");

    const open = await createSpace(s.base, "Open");
    expect((await postJson(`${s.base}/api/spaces/${open.id}/unlock`, { password: "x" })).status).toBe(400);
    expect((await postJson(`${s.base}/api/spaces/${"q".repeat(21)}/unlock`, { password: "x" })).status).toBe(404);
  });

  it("keeps the secret file private and stable across restarts", async () => {
    const first = await start();
    const space = await createSpace(first.base, "Secret", "hunter22");
    const secretFile = path.join(first.dataDir, "secret");
    expect(fs.statSync(secretFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(secretFile).size).toBe(32);
    await first.server.close();
    running = [];
    const second = await start(first.dataDir);
    const res = await postJson(`${second.base}/api/spaces/${space.id}/templates/poll`, { user: { id: "u", name: "U" } }, space.token);
    expect(res.status).toBe(201);
  });
});
