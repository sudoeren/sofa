import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";
import { connect, createSpace, fakeAi, pollDef, tempDir, testConfig } from "./helpers";

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function start(ttlHours: number) {
  const dataDir = tempDir();
  const server = buildServer(testConfig(dataDir, undefined, ttlHours), {
    createAi: () => fakeAi(),
    widgets: [pollDef],
    collabDebounceMs: 50,
  });
  servers.push(server);
  const port = await server.listen(0, "127.0.0.1");
  return { server, port, base: `http://127.0.0.1:${port}`, dataDir };
}

function age(dataDir: string, spaceId: string, hours: number) {
  // backdate through a second connection to the same database file
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "sofa.db"));
  const at = Date.now() - hours * 3_600_000;
  db.prepare("UPDATE spaces SET created_at = ? WHERE id = ?").run(at, spaceId);
  db.prepare("UPDATE docs SET updated_at = ? WHERE space_id = ?").run(at, spaceId);
  db.close();
}

describe("space expiry", () => {
  it("removes spaces untouched for longer than the TTL, with their files", async () => {
    const { server, base, dataDir } = await start(24);
    const old = await createSpace(base, "Old");
    const fresh = await createSpace(base, "Fresh");
    const form = new FormData();
    form.set("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
    const upload = await fetch(`${base}/api/spaces/${old.id}/files`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(201);
    const { fileId } = (await upload.json()) as { fileId: string };
    const filePath = server.db.getFile(fileId)?.path ?? "";
    expect(fs.existsSync(filePath)).toBe(true);

    age(dataDir, old.id, 30);
    expect(await server.sweep()).toBe(1);
    expect((await fetch(`${base}/api/spaces/${old.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/spaces/${fresh.id}`)).status).toBe(200);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("keeps a stale space while someone has it open", async () => {
    const { server, base, port, dataDir } = await start(1);
    const space = await createSpace(base, "Open");
    const client = connect(port, space.id);
    expect(await client.ready).toBe("synced");
    age(dataDir, space.id, 5);
    expect(await server.sweep()).toBe(0);
    client.destroy();
  });

  it("does nothing when no TTL is set", async () => {
    const { server, base, dataDir } = await start(0);
    const space = await createSpace(base, "Forever");
    age(dataDir, space.id, 10_000);
    expect(await server.sweep()).toBe(0);
    expect((await fetch(`${base}/api/spaces/${space.id}`)).status).toBe(200);
  });
});
