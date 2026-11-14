import {
  type Material,
  materialsArray,
  metaMap,
  readTool,
  readToolState,
  SPACE_EXPORT_FORMAT,
  SPACE_EXPORT_VERSION,
  type SpaceExport,
  type SpaceInfo,
  toolStateMap,
  toolsMap,
} from "@sofa/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { slugify } from "../app";
import { connect, createSpace, postJson, type Running, startServer, tempDir } from "./helpers";

let s: Running;

beforeAll(async () => {
  s = await startServer(tempDir());
});

afterAll(async () => {
  await s.server.close();
});

const user = { id: "u-1", name: "Rae" };

async function exportSpace(spaceId: string, token?: string): Promise<Response> {
  return fetch(`${s.base}/api/spaces/${spaceId}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** A space with one tool holding some state, a note and a file material. */
async function filledSpace(title: string, password?: string) {
  const space = await createSpace(s.base, title, password);
  const res = await postJson(
    `${s.base}/api/spaces/${space.id}/templates/poll`,
    { user },
    space.token,
  );
  expect(res.status).toBe(201);
  const { toolId } = (await res.json()) as { toolId: string };
  await s.server.docs.transact(space.id, (doc) => {
    const tool = toolsMap(doc).get(toolId);
    if (!tool) throw new Error("tool missing");
    toolStateMap(tool).set("vote:u-1", { name: "Rae", choices: ["A"], at: 1 });
    const base = { authorId: user.id, authorName: user.name, createdAt: 5 };
    const materials: Material[] = [
      { id: "m1", kind: "note", text: "Bring snacks", ...base },
      {
        id: "m2",
        kind: "file",
        fileId: "f-123",
        fileName: "tickets.pdf",
        mime: "application/pdf",
        size: 1200,
        ...base,
      },
    ];
    materialsArray(doc).push(materials);
  });
  return { space, toolId };
}

describe("export", () => {
  it("round-trips a space through import", async () => {
    const { space, toolId } = await filledSpace("Summer trip");
    const res = await exportSpace(space.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="summer-trip.sofa.json"',
    );
    expect(res.headers.get("content-type")).toContain("application/json");
    const exported = (await res.json()) as SpaceExport;
    expect(exported).toMatchObject({
      format: SPACE_EXPORT_FORMAT,
      version: SPACE_EXPORT_VERSION,
      title: "Summer trip",
    });

    const imported = await postJson(`${s.base}/api/import`, {
      ...exported,
      title: "Summer trip (copy)",
    });
    expect(imported.status).toBe(201);
    const info = (await imported.json()) as SpaceInfo;
    expect(info.id).not.toBe(space.id);
    expect(info.title).toBe("Summer trip (copy)");
    expect(info.locked).toBe(false);
    expect(info.token).toBeUndefined();

    const original = connect(s.port, space.id);
    const copy = connect(s.port, info.id);
    try {
      expect(await original.ready).toBe("synced");
      expect(await copy.ready).toBe("synced");
      const before = toolsMap(original.doc).get(toolId);
      const after = toolsMap(copy.doc).get(toolId);
      expect(before && after).toBeTruthy();
      if (!before || !after) return;
      expect(readTool(after)).toEqual(readTool(before));
      expect(readToolState(after)).toEqual(readToolState(before));
      expect(readToolState(after)["vote:u-1"]).toMatchObject({ choices: ["A"] });

      const meta = metaMap(copy.doc);
      expect(meta.get("title")).toBe("Summer trip (copy)");
      expect(meta.get("createdAt")).toBe(info.createdAt);
      expect(meta.get("locked")).toBe(false);

      const materials = materialsArray(copy.doc).toArray();
      expect(materials.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(materials[1]).toMatchObject({ kind: "file", fileName: "tickets.pdf" });
      expect(materials[1]?.fileId).toBeUndefined();
      // The source space keeps its file.
      expect(materialsArray(original.doc).toArray()[1]?.fileId).toBe("f-123");
    } finally {
      original.destroy();
      copy.destroy();
    }
  });

  it("needs the token for a locked space", async () => {
    const { space } = await filledSpace("Secret plans", "hunter22");
    expect((await exportSpace(space.id)).status).toBe(401);
    expect((await exportSpace(space.id, "wrong")).status).toBe(401);
    const res = await exportSpace(space.id, space.token);
    expect(res.status).toBe(200);
    const exported = (await res.json()) as SpaceExport;
    expect(exported.title).toBe("Secret plans");
  });

  it("answers 404 for an unknown space", async () => {
    expect((await exportSpace("x".repeat(21))).status).toBe(404);
  });

  it("imports into a locked space when a password is given", async () => {
    const { space } = await filledSpace("Locked copy");
    const exported = (await (await exportSpace(space.id)).json()) as SpaceExport;
    const res = await postJson(`${s.base}/api/import`, { ...exported, password: "secret1" });
    expect(res.status).toBe(201);
    const info = (await res.json()) as SpaceInfo;
    expect(info.locked).toBe(true);
    expect(typeof info.token).toBe("string");

    const denied = connect(s.port, info.id);
    const allowed = connect(s.port, info.id, info.token);
    try {
      expect(await denied.ready).toMatch(/^denied:/);
      expect(await allowed.ready).toBe("synced");
      expect(metaMap(allowed.doc).get("locked")).toBe(true);
      expect(toolsMap(allowed.doc).size).toBe(1);
    } finally {
      denied.destroy();
      allowed.destroy();
    }
  });

  it("slugifies titles for the file name", () => {
    expect(slugify("Weekend in Lisbon!")).toBe("weekend-in-lisbon");
    expect(slugify("  Café   Crème ")).toBe("cafe-creme");
    expect(slugify("???")).toBe("space");
  });
});

describe("import validation", () => {
  const valid = (doc: string): SpaceExport => ({
    format: SPACE_EXPORT_FORMAT,
    version: SPACE_EXPORT_VERSION,
    title: "Imported",
    exportedAt: Date.now(),
    doc,
  });

  function encode(fill: (doc: Y.Doc) => void): string {
    const doc = new Y.Doc();
    fill(doc);
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  }

  const spaceDoc = encode((doc) => metaMap(doc).set("title", "x"));

  it("accepts a minimal space document", async () => {
    expect((await postJson(`${s.base}/api/import`, valid(spaceDoc))).status).toBe(201);
  });

  it("rejects a wrong format or version", async () => {
    const wrongFormat = { ...valid(spaceDoc), format: "other-app" };
    const wrongVersion = { ...valid(spaceDoc), version: 2 };
    expect((await postJson(`${s.base}/api/import`, wrongFormat)).status).toBe(400);
    expect((await postJson(`${s.base}/api/import`, wrongVersion)).status).toBe(400);
  });

  it("rejects an oversize body", async () => {
    const big = valid("A".repeat(21 * 1024 * 1024));
    expect((await postJson(`${s.base}/api/import`, big)).status).toBe(413);
  });

  it("rejects bytes that are not a space document", async () => {
    const random = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256),
    ).toString("base64");
    const notBase64 = "this is not base64 at all!";
    const otherDoc = encode((doc) => doc.getMap("something").set("a", 1));
    const noMeta = encode((doc) => doc.getMap("tools").set("t", new Y.Map()));
    const toolsAsArray = encode((doc) => {
      metaMap(doc).set("title", "x");
      doc.getArray("tools").push([1, 2, 3]);
    });
    for (const doc of [random, notBase64, otherDoc, noMeta, toolsAsArray]) {
      const res = await postJson(`${s.base}/api/import`, valid(doc));
      expect(res.status, doc.slice(0, 20)).toBe(400);
    }
    // Truly random bytes too, a few times.
    for (let i = 0; i < 5; i++) {
      const bytes = new Uint8Array(2048).map(() => Math.floor(Math.random() * 256));
      const res = await postJson(
        `${s.base}/api/import`,
        valid(Buffer.from(bytes).toString("base64")),
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects too many tools", async () => {
    const crowded = encode((doc) => {
      metaMap(doc).set("title", "x");
      const tools = toolsMap(doc);
      for (let i = 0; i < 201; i++) {
        const tool = new Y.Map<unknown>();
        tools.set(`t${i}`, tool);
        tool.set("id", `t${i}`);
      }
    });
    expect((await postJson(`${s.base}/api/import`, valid(crowded))).status).toBe(400);
  });
});
