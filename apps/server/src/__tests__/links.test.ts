import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRateLimiter, hashPassword, signSpaceToken, verifyPassword, verifySpaceToken } from "../auth";
import { sanitizeFileName } from "../files";
import { createLinkPreviewer, isPublicAddress, parseHtmlMeta } from "../links";

describe("isPublicAddress", () => {
  const refused = [
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "[::ffff:127.0.0.1]",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:192.168.0.1",
    "::ffff:0.0.0.0",
    "::127.0.0.1",
    "::8.8.8.8",
    "64:ff9b::7f00:1",
    "64:ff9b::10.0.0.1",
    "64:ff9b:1::1",
    "2002:7f00:1::1",
    "2002:a00:1::1",
    "2002:c0a8:101::",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:db8::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "ff0e::1",
    "100::1",
    "4000::1",
    "",
    "localhost",
    "example.com",
    "1.2.3",
    "256.1.1.1",
    "1.2.3.4.5",
    "0x7f.0.0.1",
    "gggg::1",
  ];
  for (const address of refused) {
    it(`refuses ${JSON.stringify(address)}`, () => expect(isPublicAddress(address)).toBe(false));
  }

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.0.1",
    "192.167.1.1",
    "198.17.0.1",
    "198.20.0.1",
    "223.255.255.254",
    "2606:4700:4700::1111",
    "[2606:4700:4700::1111]",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "64:ff9b::8.8.8.8",
    "2002:808:808::1",
  ];
  for (const address of allowed) {
    it(`allows ${address}`, () => expect(isPublicAddress(address)).toBe(true));
  }
});

describe("parseHtmlMeta", () => {
  it("prefers og tags and decodes entities", () => {
    const html = `<html><head><title>Plain &amp; simple</title>
      <meta name="description" content="plain description">
      <meta content='OG &quot;title&quot; &#8211; x' property="og:title">
      <meta property=og:description content="og   description&#x21;"></head></html>`;
    expect(parseHtmlMeta(html)).toEqual({ title: 'OG "title" \u2013 x', description: "og description!" });
  });
  it("falls back to title and meta description, and to empty strings", () => {
    expect(parseHtmlMeta("<title>\n Hello\tworld </title><meta name='Description' content='d'>")).toEqual({
      title: "Hello world",
      description: "d",
    });
    expect(parseHtmlMeta("<p>nothing</p>")).toEqual({ title: "", description: "" });
  });
  it("caps very long values", () => {
    expect(parseHtmlMeta(`<title>${"x".repeat(5000)}</title>`).title.length).toBeLessThanOrEqual(300);
  });
});

describe("link previewer", () => {
  let server: http.Server;
  let origin = "";
  const seen: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      const url = req.url ?? "";
      if (url === "/page") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<title>Local page</title><meta name=description content='About it'>");
      } else if (url === "/gzip") {
        res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
        res.end(zlib.gzipSync("<title>Zipped</title>"));
      } else if (url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"title":"<title>no</title>"}');
      } else if (url === "/redirect") {
        res.writeHead(302, { Location: "/page" });
        res.end();
      } else if (url === "/to-metadata") {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      } else if (url === "/to-file") {
        res.writeHead(302, { Location: "file:///etc/passwd" });
        res.end();
      } else if (url.startsWith("/loop")) {
        res.writeHead(302, { Location: `/loop${Number(url.slice(5) || 0) + 1}` });
        res.end();
      } else if (url === "/huge") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("<title>Big one</title>");
        const filler = "x".repeat(64 * 1024);
        const pump = () => {
          while (res.write(filler)) {}
          res.once("drain", pump);
        };
        res.on("error", () => {});
        pump();
      } else if (url === "/slow") {
        // never answers
      } else {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<title>Missing</title>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  // Loopback is allowed here only so the fetcher can reach the local test server.
  const local = createLinkPreviewer({
    isAllowedAddress: (address) => address === "127.0.0.1" || isPublicAddress(address),
    timeoutMs: 1500,
    maxBytes: 128 * 1024,
  });
  const strict = createLinkPreviewer({ timeoutMs: 1500 });

  it("reads title and description", async () => {
    expect(await local(`${origin}/page`)).toEqual({ url: `${origin}/page`, title: "Local page", description: "About it" });
    expect((await local(`${origin}/gzip`)).title).toBe("Zipped");
    expect((await local(`${origin}/redirect`)).title).toBe("Local page");
  });

  it("ignores non html, error pages and oversized bodies beyond the limit", async () => {
    expect((await local(`${origin}/json`)).title).toBe("");
    expect((await local(`${origin}/nope`)).title).toBe("");
    expect((await local(`${origin}/huge`)).title).toBe("Big one");
  });

  it("re-validates redirects and limits their number", async () => {
    expect(await local(`${origin}/to-metadata`)).toEqual({ url: `${origin}/to-metadata`, title: "", description: "" });
    expect((await local(`${origin}/to-file`)).title).toBe("");
    seen.length = 0;
    expect((await local(`${origin}/loop`)).title).toBe("");
    expect(seen).toEqual(["/loop", "/loop1", "/loop2", "/loop3"]);
  });

  it("times out", async () => {
    const started = Date.now();
    expect((await local(`${origin}/slow`)).title).toBe("");
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("never contacts private addresses with the default filter", async () => {
    seen.length = 0;
    const port = new URL(origin).port;
    const targets = [
      `${origin}/page`,
      `http://localhost:${port}/page`,
      `http://[::ffff:127.0.0.1]:${port}/page`,
      `http://[::1]:${port}/page`,
      `http://0.0.0.0:${port}/page`,
      `http://2130706433:${port}/page`,
      `http://0x7f.1:${port}/page`,
      `http://user:pw@127.0.0.1:${port}/page`,
      "http://169.254.169.254/",
      "http://10.0.0.1/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "gopher://127.0.0.1/",
      "nonsense",
    ];
    for (const target of targets) {
      expect(await strict(target)).toEqual({ url: target, title: "", description: "" });
    }
    expect(seen).toEqual([]);
  });
});

describe("auth", () => {
  it("hashes passwords with a random salt and verifies them", async () => {
    const one = await hashPassword("correct horse");
    const two = await hashPassword("correct horse");
    expect(one).toMatch(/^scrypt\$\d+\$/);
    expect(one).not.toBe(two);
    expect(await verifyPassword("correct horse", one)).toBe(true);
    expect(await verifyPassword("wrong horse", one)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$$")).toBe(false);
  });

  it("signs tokens per space and secret", () => {
    const secret = Buffer.alloc(32, 1);
    const token = signSpaceToken(secret, "a".repeat(21));
    expect(verifySpaceToken(secret, "a".repeat(21), token)).toBe(true);
    expect(verifySpaceToken(secret, "b".repeat(21), token)).toBe(false);
    expect(verifySpaceToken(Buffer.alloc(32, 2), "a".repeat(21), token)).toBe(false);
    expect(verifySpaceToken(secret, "a".repeat(21), `${token}x`)).toBe(false);
    expect(verifySpaceToken(secret, "a".repeat(21), "")).toBe(false);
    expect(verifySpaceToken(secret, "a".repeat(21), undefined)).toBe(false);
    expect(verifySpaceToken(secret, "a".repeat(21), null)).toBe(false);
  });

  it("limits per key and window", async () => {
    const limiter = createRateLimiter(2, 50);
    expect([limiter.hit("a"), limiter.hit("a"), limiter.hit("a"), limiter.hit("b")]).toEqual([true, true, false, true]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(limiter.hit("a")).toBe(true);
    limiter.hit("a");
    limiter.reset("a");
    expect(limiter.hit("a")).toBe(true);
  });
});

describe("sanitizeFileName", () => {
  it("drops paths, control characters and reserved characters", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("a\u0000b\r\n.txt")).toBe("ab.txt");
    expect(sanitizeFileName('we"ird<name>?.md')).toBe("we_ird_name__.md");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName(".env")).toBe("env");
    expect(sanitizeFileName("")).toBe("file");
    const long = sanitizeFileName(`${"n".repeat(400)}.jpeg`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".jpeg")).toBe(true);
  });
});
