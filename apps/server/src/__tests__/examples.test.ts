import {
  listTools,
  materialsArray,
  metaMap,
  readToolState,
  type ServerConfig,
  toolsMap,
} from "@sofa/shared";
import { EXAMPLES, getWidgetDef } from "@sofa/widgets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, postJson, type Running, startServer, tempDir, waitFor } from "./helpers";

let s: Running;

beforeAll(async () => {
  s = await startServer(tempDir());
});

afterAll(async () => {
  await s.server.close();
});

const user = { id: "u-1", name: "Rae" };

describe("config", () => {
  it("exposes the demo flag, the space TTL and the examples", async () => {
    const res = await fetch(`${s.base}/api/config`);
    const body = (await res.json()) as ServerConfig;
    expect(body.demo).toBe(false);
    expect(body.spaceTtlHours).toBe(0);
    expect(body.examples).toEqual(
      EXAMPLES.map(({ id, title, description }) => ({ id, title, description })),
    );
  });
});

describe("examples", () => {
  for (const example of EXAMPLES) {
    it(`creates a space from ${example.id}`, async () => {
      const res = await postJson(`${s.base}/api/examples/${example.id}`, { user });
      expect(res.status).toBe(201);
      const info = (await res.json()) as { id: string; title: string; locked: boolean };
      expect(info.title).toBe(example.title);
      expect(info.locked).toBe(false);

      const client = connect(s.port, info.id);
      try {
        expect(await client.ready).toBe("synced");
        await waitFor(() => toolsMap(client.doc).size === example.tools.length);
        expect(metaMap(client.doc).get("title")).toBe(example.title);
        const tools = listTools(client.doc);
        expect(tools.map((tool) => tool.title)).toEqual(example.tools.map((tool) => tool.title));
        for (const [index, tool] of tools.entries()) {
          const source = example.tools[index];
          expect(tool).toMatchObject({
            kind: "widget",
            status: "ready",
            version: 1,
            order: index + 1,
            createdBy: user.id,
            span: source?.span ?? 1,
          });
          const def = getWidgetDef(tool.widgetType ?? "");
          expect(def?.configSchema.safeParse(tool.config).success).toBe(true);
          const yTool = toolsMap(client.doc).get(tool.id);
          expect(yTool && readToolState(yTool)).toEqual(source?.state);
        }
        const materials = materialsArray(client.doc).toArray();
        expect(materials.length).toBe(example.materials?.length ?? 0);
        for (const material of materials) {
          expect(material.authorId).toBe(example.author.id);
          expect(material.authorName).toBe(example.author.name);
        }
      } finally {
        client.destroy();
      }
    });
  }

  it("answers 404 for an unknown example", async () => {
    const res = await postJson(`${s.base}/api/examples/no-such-example`, { user });
    expect(res.status).toBe(404);
  });

  it("validates the body", async () => {
    const res = await postJson(`${s.base}/api/examples/${EXAMPLES[0]?.id}`, {});
    expect(res.status).toBe(400);
  });

  it("is rate limited like space creation", async () => {
    const limited = await startServer(tempDir(), {
      rateLimits: { createSpace: { limit: 2, windowMs: 60_000 } },
    });
    try {
      const id = EXAMPLES[0]?.id;
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await postJson(`${limited.base}/api/examples/${id}`, { user })).status);
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      await limited.server.close();
    }
  });
});
