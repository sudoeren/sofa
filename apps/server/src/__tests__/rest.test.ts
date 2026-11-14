import fs from "node:fs";
import path from "node:path";
import { LIMITS, listTools, readToolState, toolsMap } from "@sofa/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpace, postJson, type Running, startServer, tempDir } from "./helpers";

let s: Running;
const webDir = tempDir();

beforeAll(async () => {
  fs.mkdirSync(path.join(webDir, "assets"));
  fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>shell</title>");
  fs.writeFileSync(path.join(webDir, "assets", "app-abc123.js"), "console.log(1)");
  s = await startServer(
    tempDir(),
    { rateLimits: { generate: { limit: 3, windowMs: 60_000 } } },
    webDir,
  );
});

afterAll(async () => {
  await s.server.close();
});

function upload(
  spaceId: string,
  name: string,
  type: string,
  data: Uint8Array | string,
  token?: string,
) {
  const form = new FormData();
  form.append("file", new File([data], name, { type }));
  return fetch(`${s.base}/api/spaces/${spaceId}/files`, {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("spaces", () => {
  it("creates and reads a space", async () => {
    const space = await createSpace(s.base, "  Summer trip  ");
    expect(space.id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(space.title).toBe("Summer trip");
    expect(space.locked).toBe(false);
    expect(space.token).toBeUndefined();

    const res = await fetch(`${s.base}/api/spaces/${space.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: space.id,
      title: "Summer trip",
      createdAt: space.createdAt,
      locked: false,
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("rejects invalid bodies with a json error", async () => {
    for (const body of [
      {},
      { title: "" },
      { title: "x".repeat(LIMITS.titleLength + 1) },
      { title: "ok", password: "abc" },
      "{nope",
    ]) {
      const res = await postJson(`${s.base}/api/spaces`, body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(typeof json.error).toBe("string");
      expect(json.error).not.toMatch(/\bat\s.+:\d+/);
    }
  });

  it("rejects oversized json bodies", async () => {
    const res = await postJson(`${s.base}/api/spaces`, { title: "ok", junk: "x".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty("error");
  });

  it("answers 404 for unknown spaces and unknown api routes", async () => {
    const missing = await fetch(`${s.base}/api/spaces/${"a".repeat(21)}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Space not found" });
    expect((await fetch(`${s.base}/api/spaces/bad$id`)).status).toBe(404);
    const unknown = await fetch(`${s.base}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Not found" });
  });
});

describe("config, generate and templates", () => {
  it("reports ai info and templates", async () => {
    const res = await fetch(`${s.base}/api/config`);
    expect(await res.json()).toMatchObject({
      aiEnabled: true,
      provider: "fake",
      model: "fake-1",
      templates: [{ id: "poll", title: "Poll", description: "Vote on a few options." }],
    });
  });

  it("validates, forwards and rate limits generate", async () => {
    const space = await createSpace(s.base);
    const url = `${s.base}/api/spaces/${space.id}/generate`;
    const user = { id: "u1", name: "Ada" };

    expect((await postJson(url, { prompt: "", user })).status).toBe(400);
    expect((await postJson(url, { prompt: "a poll" })).status).toBe(400);
    expect(
      (await postJson(url, { prompt: "x", user, ai: { provider: "other", apiKey: "12345678" } }))
        .status,
    ).toBe(400);
    expect(
      (await postJson(`${s.base}/api/spaces/${"b".repeat(21)}/generate`, { prompt: "x", user }))
        .status,
    ).toBe(404);
    expect(s.ai.calls).toHaveLength(0);

    const ok = await postJson(url, { prompt: " a poll ", user });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ messageId: "msg-1" });
    expect(s.ai.calls[0]).toEqual({ spaceId: space.id, body: { prompt: "a poll", user } });

    expect((await postJson(url, { prompt: "two", user })).status).toBe(202);
    expect((await postJson(url, { prompt: "three", user })).status).toBe(202);
    const limited = await postJson(url, { prompt: "four", user });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toHaveProperty("error");
    expect(s.ai.calls).toHaveLength(3);
  });

  it("creates a widget tool from a template", async () => {
    const space = await createSpace(s.base);
    const user = { id: "u1", name: "Ada" };
    const base = `${s.base}/api/spaces/${space.id}/templates`;
    expect((await postJson(`${base}/nope`, { user })).status).toBe(404);
    expect((await postJson(`${base}/poll`, {})).status).toBe(400);

    const first = await postJson(`${base}/poll`, { user });
    expect(first.status).toBe(201);
    const { toolId } = (await first.json()) as { toolId: string };
    const second = (await (await postJson(`${base}/poll`, { user })).json()) as { toolId: string };

    const tools = await s.server.docs.read(space.id, (doc) => listTools(doc));
    expect(tools.map((tool) => tool.id)).toEqual([toolId, second.toolId]);
    expect(tools[0]).toMatchObject({
      id: toolId,
      title: "Quick poll",
      description: "Pick one",
      kind: "widget",
      widgetType: "poll",
      config: { question: "Where?", options: ["A", "B"] },
      html: "",
      status: "ready",
      version: 1,
      order: 1,
      span: 1,
      createdBy: "u1",
    });
    expect(tools[1]?.order).toBe(2);
    const state = await s.server.docs.read(space.id, (doc) => {
      const tool = toolsMap(doc).get(toolId);
      return tool ? readToolState(tool) : null;
    });
    expect(state).toEqual({ "note:1": "hello" });
  });
});

describe("files", () => {
  it("stores uploads and serves images inline, everything else as attachment", async () => {
    const space = await createSpace(s.base);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const res = await upload(space.id, "../../etc/pa\u202ess wd.png", "image/png", png);
    expect(res.status).toBe(201);
    const info = (await res.json()) as {
      fileId: string;
      name: string;
      mime: string;
      size: number;
      url: string;
    };
    expect(info).toMatchObject({
      name: "pass wd.png",
      mime: "image/png",
      size: 7,
      url: `/api/files/${info.fileId}`,
    });
    expect(fs.existsSync(path.join(s.dataDir, "files", info.fileId))).toBe(true);

    const image = await fetch(`${s.base}${info.url}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-disposition")).toMatch(/^inline; filename="pass wd.png"/);
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);

    const svg = (await (
      await upload(space.id, "x.svg", "image/svg+xml", "<svg onload='alert(1)'/>")
    ).json()) as { fileId: string };
    const svgRes = await fetch(`${s.base}/api/files/${svg.fileId}`);
    expect(svgRes.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(svgRes.headers.get("content-type")).toBe("application/octet-stream");
    expect(svgRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(svgRes.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");

    const html = (await (
      await upload(space.id, "p.html", "text/html", "<script>1</script>")
    ).json()) as { fileId: string };
    const htmlRes = await fetch(`${s.base}/api/files/${html.fileId}`);
    expect(htmlRes.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(htmlRes.headers.get("content-type")).not.toMatch(/html/);

    const note = (await (await upload(space.id, 'n\u00f6t"es.md', "", "# hi")).json()) as {
      fileId: string;
      mime: string;
    };
    const noteRes = await fetch(`${s.base}/api/files/${note.fileId}`);
    expect(noteRes.headers.get("content-disposition")).toBe(
      `attachment; filename="n_t_es.md"; filename*=UTF-8''n%C3%B6t_es.md`,
    );
    expect(await noteRes.text()).toBe("# hi");

    expect(await s.server.files.readText(note.fileId, 1000)).toBe("# hi");
    expect(await s.server.files.readText(note.fileId, 2)).toBeNull();
    expect(await s.server.files.readText(info.fileId, 1000)).toBeNull();
    expect(await s.server.files.readText("missing", 1000)).toBeNull();
    expect(s.server.files.get(info.fileId)).toMatchObject({
      spaceId: space.id,
      name: "pass wd.png",
      size: 7,
    });

    expect((await fetch(`${s.base}/api/files/doesnotexist`)).status).toBe(404);
    expect((await fetch(`${s.base}/api/files/..%2Fsecret`)).status).toBe(404);
  });

  it("enforces the size limit, the field name and the per space count", async () => {
    const space = await createSpace(s.base);
    const big = await upload(
      space.id,
      "big.bin",
      "application/octet-stream",
      new Uint8Array(LIMITS.fileBytes + 1),
    );
    expect(big.status).toBe(413);
    expect(await big.json()).toHaveProperty("error");

    const form = new FormData();
    form.append("other", "x");
    const wrong = await fetch(`${s.base}/api/spaces/${space.id}/files`, {
      method: "POST",
      body: form,
    });
    expect(wrong.status).toBe(400);
    expect((await postJson(`${s.base}/api/spaces/${space.id}/files`, { a: 1 })).status).toBe(400);
    expect((await upload("c".repeat(21), "a.txt", "text/plain", "x")).status).toBe(404);

    for (let i = 0; i < LIMITS.filesPerSpace; i++) {
      const res = await upload(space.id, `f${i}.txt`, "text/plain", "x");
      expect(res.status).toBe(201);
    }
    const over = await upload(space.id, "over.txt", "text/plain", "x");
    expect(over.status).toBe(409);
    expect(await over.json()).toHaveProperty("error");
  });
});

describe("links route", () => {
  it("returns an empty preview for private addresses instead of fetching them", async () => {
    const space = await createSpace(s.base);
    const url = `${s.base}/api/spaces/${space.id}/links`;
    for (const target of [
      `${s.base}/api/config`,
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://localhost/",
    ]) {
      const res = await postJson(url, { url: target });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: target, title: "", description: "" });
    }
    expect((await postJson(url, { url: "not a url" })).status).toBe(400);
    expect((await postJson(url, {})).status).toBe(400);
  });
});

describe("web app", () => {
  it("serves static files, the spa fallback and never the api or collab paths", async () => {
    const root = await fetch(`${s.base}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toMatch(/text\/html/);
    expect(root.headers.get("cache-control")).toBe("no-cache");
    expect(await root.text()).toContain("shell");

    const deep = await fetch(`${s.base}/s/${"a".repeat(21)}`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain("shell");

    const asset = await fetch(`${s.base}/assets/app-abc123.js`);
    expect(asset.headers.get("content-type")).toMatch(/javascript/);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await fetch(`${s.base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${s.base}/collab`)).status).toBe(404);
    expect((await fetch(`${s.base}/api/unknown/path`)).status).toBe(404);

    const escaped = await fetch(`${s.base}/..%2f..%2f..%2f..%2fetc%2fpasswd`);
    expect(await escaped.text()).not.toContain("root:");
    const secret = await fetch(`${s.base}/%2e%2e/${path.basename(s.dataDir)}/secret`);
    expect(await secret.text()).toContain("shell");
  });
});
