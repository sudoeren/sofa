import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import type { LinkPreview } from "@sofa/shared";

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 600;

function parseIPv4(input: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (parts.some((part) => part > 255)) return null;
  return parts as [number, number, number, number];
}

/** Eight 16-bit groups, or null when the input is not an IPv6 address. */
function parseIPv6(input: string): number[] | null {
  if (!net.isIPv6(input)) return null;
  let text = input;
  const tail = text.slice(text.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  if (
    groups.length !== 8 ||
    groups.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff)
  )
    return null;
  return groups;
}

function isPublicIPv4(parts: readonly number[]): boolean {
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  if (a === 0) return false; // "this network", 0.0.0.0
  if (a === 10) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function embeddedIPv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPublicIPv6(g: readonly number[]): boolean {
  const at = (index: number) => g[index] ?? 0;
  const leadingZeros = (count: number) => g.slice(0, count).every((group) => group === 0);
  // IPv4-mapped ::ffff:a.b.c.d: judge the IPv4 address it stands for.
  if (leadingZeros(5) && at(5) === 0xffff) return isPublicIPv4(embeddedIPv4(at(6), at(7)));
  // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (leadingZeros(6)) return false;
  // NAT64 64:ff9b::/96 embeds an IPv4 address; the local-use 64:ff9b:1::/48 is refused.
  if (at(0) === 0x64 && at(1) === 0xff9b) {
    if (at(2) === 0 && at(3) === 0 && at(4) === 0 && at(5) === 0)
      return isPublicIPv4(embeddedIPv4(at(6), at(7)));
    return false;
  }
  // 6to4 2002:AABB:CCDD::/48 embeds an IPv4 address.
  if (at(0) === 0x2002) return isPublicIPv4(embeddedIPv4(at(1), at(2)));
  // 2001::/23 special purpose (Teredo, ORCHID, ...) and 2001:db8::/32 documentation.
  if (at(0) === 0x2001 && (at(1) < 0x200 || at(1) === 0xdb8)) return false;
  // Everything outside global unicast 2000::/3: unique local fc00::/7, link-local fe80::/10,
  // site-local fec0::/10, multicast ff00::/8, discard 100::/64 and unassigned space.
  return (at(0) & 0xe000) === 0x2000;
}

/**
 * True only for addresses that are safe to fetch on behalf of a member: globally routable
 * unicast. Anything that is not a valid IP literal is refused.
 */
export function isPublicAddress(input: string): boolean {
  let text = input.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const v4 = parseIPv4(text);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(text);
  if (v6) return isPublicIPv6(v6);
  return false;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number(body.slice(1));
      if (
        !Number.isInteger(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function clean(text: string | undefined, maxLength: number): string {
  if (!text) return "";
  const value = decodeEntities(text)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

/** Title and description from og/twitter/meta tags and the title element. */
export function parseHtmlMeta(html: string): { title: string; description: string } {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      const name = m[1];
      if (name) attrs.set(name.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").trim().toLowerCase();
    const content = attrs.get("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  return {
    title: clean(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, MAX_TITLE_LENGTH),
    description: clean(
      meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"),
      MAX_DESCRIPTION_LENGTH,
    ),
  };
}

export type LinkPreviewer = (url: string) => Promise<LinkPreview>;

export type LinkOptions = {
  /** address filter; replaced in tests that need to reach a local server */
  isAllowedAddress?: (address: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

type Target = { address: string; family: 4 | 6 };

type PageResponse = { status: number; location: string | null; html: string | null };

function decodeBody(data: Buffer, contentType: string): string {
  const declared =
    /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(data.subarray(0, 2048).toString("latin1"))?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(data);
    } catch {
      // unknown label: fall through to UTF-8
    }
  }
  return new TextDecoder("utf-8").decode(data);
}

function requestPage(
  url: URL,
  target: Target,
  signal: AbortSignal,
  maxBytes: number,
): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en",
          "User-Agent": "Mozilla/5.0 (compatible; link-preview)",
        },
        // Pin the connection to the address that was vetted, so a second DNS answer
        // cannot point the socket somewhere else.
        lookup: (_host, options, callback) => {
          const cb = callback as (error: Error | null, address: unknown, family?: number) => void;
          if (
            typeof options === "object" &&
            options !== null &&
            (options as { all?: boolean }).all
          ) {
            cb(null, [{ address: target.address, family: target.family }]);
          } else {
            cb(null, target.address, target.family);
          }
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location =
          typeof response.headers.location === "string" ? response.headers.location : null;
        const contentType = String(response.headers["content-type"] ?? "");
        const isHtml = /^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
        if (status < 200 || status >= 300 || !isHtml) {
          response.destroy();
          resolve({ status, location, html: null });
          return;
        }

        const encoding = String(response.headers["content-encoding"] ?? "identity")
          .trim()
          .toLowerCase();
        let stream: Readable = response;
        if (encoding === "gzip" || encoding === "x-gzip")
          stream = response.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = response.pipe(zlib.createInflate());
        else if (encoding === "br") stream = response.pipe(zlib.createBrotliDecompress());
        else if (encoding !== "identity" && encoding !== "") {
          response.destroy();
          resolve({ status, location, html: null });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          response.destroy();
          if (stream !== response) stream.destroy();
          resolve({ status, location, html: decodeBody(Buffer.concat(chunks), contentType) });
        };
        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          const room = maxBytes - size;
          chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          size += Math.min(chunk.length, room);
          // The head of a page is enough; stop reading instead of failing.
          if (size >= maxBytes) finish();
        });
        stream.on("end", finish);
        // A truncated or broken stream still yields whatever was read.
        stream.on("error", finish);
        response.on("error", finish);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

export function createLinkPreviewer(options: LinkOptions = {}): LinkPreviewer {
  const isAllowed = options.isAllowedAddress ?? isPublicAddress;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  async function resolveTarget(url: URL): Promise<Target> {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("unsupported protocol");
    if (url.username || url.password) throw new Error("credentials in url");
    const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    if (!host) throw new Error("missing host");
    const literal = net.isIP(host);
    const answers = literal
      ? [{ address: host, family: literal }]
      : await dns.lookup(host, { all: true, verbatim: true });
    const first = answers[0];
    // Every answer must be acceptable, so a name that mixes public and internal records is refused.
    if (!first || !answers.every((answer) => isAllowed(answer.address)))
      throw new Error("address not allowed");
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  async function load(
    start: URL,
    signal: AbortSignal,
  ): Promise<{ title: string; description: string }> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await resolveTarget(url);
      if (signal.aborted) throw new Error("timeout");
      const response = await requestPage(url, target, signal, maxBytes);
      if (response.status >= 300 && response.status < 400 && response.location) {
        // The next hop goes through resolveTarget again before anything is sent to it.
        url = new URL(response.location, url);
        continue;
      }
      return response.html === null ? { title: "", description: "" } : parseHtmlMeta(response.html);
    }
    throw new Error("too many redirects");
  }

  return async function preview(input: string): Promise<LinkPreview> {
    const empty: LinkPreview = { url: input, title: "", description: "" };
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return empty;
    }
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    try {
      const work = load(url, controller.signal);
      // After a timeout the losing promise may still reject; that is expected.
      work.catch(() => {});
      const found = await Promise.race([work, timeout]);
      return { url: input, title: found.title, description: found.description };
    } catch {
      return empty;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
