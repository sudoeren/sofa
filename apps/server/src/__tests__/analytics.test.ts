import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { injectAnalytics } from "../app";
import { buildServer, type SofaServer } from "../server";
import { fakeAi, pollDef, tempDir, testConfig } from "./helpers";

const analytics = { src: "https://stats.example.com/script.js", websiteId: "abc-123" };
const tag =
  '<script defer src="https://stats.example.com/script.js" data-website-id="abc-123"></script>';

describe("injectAnalytics", () => {
  it("puts the script before </head>", () => {
    expect(
      injectAnalytics("<html><head><title>x</title></head><body></body></html>", analytics),
    ).toBe(`<html><head><title>x</title>${tag}\n</head><body></body></html>`);
  });

  it("escapes attribute values", () => {
    const html = injectAnalytics("<head></head>", { src: 'https://a.b/"x', websiteId: "id" });
    expect(html).toContain('src="https://a.b/&quot;x"');
  });
});

describe("app shell with analytics", () => {
  let server: SofaServer;
  let base: string;

  beforeAll(async () => {
    const dataDir = tempDir();
    const webDir = tempDir();
    fs.writeFileSync(
      path.join(webDir, "index.html"),
      "<!doctype html><head><title>shell</title></head>",
    );
    server = buildServer(
      { ...testConfig(dataDir, webDir), analytics },
      { createAi: () => fakeAi(), widgets: [pollDef], collabDebounceMs: 100 },
    );
    const port = await server.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves the shell with the script on every page route", async () => {
    for (const route of ["/", "/index.html", `/s/${"a".repeat(21)}`]) {
      const res = await fetch(`${base}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      const text = await res.text();
      expect(text).toContain("shell");
      expect(text).toContain(tag);
    }
  });
});
