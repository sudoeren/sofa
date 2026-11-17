import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { HttpBindings } from "@hono/node-server";
import {
  COLLAB_PATH,
  chatArray,
  createSpaceBody,
  type FileInfo,
  type GenerateResponse,
  generateBody,
  importBody,
  isSpaceId,
  LIMITS,
  type LinkPreview,
  linkBody,
  type Material,
  materialsArray,
  metaMap,
  newId,
  newSpaceId,
  nextToolOrder,
  putTool,
  type ServerConfig,
  SPACE_EXPORT_FORMAT,
  SPACE_EXPORT_VERSION,
  type SpaceExport,
  type SpaceInfo,
  type ToolRecord,
  toolsMap,
  type UnlockResponse,
  type UseTemplateResponse,
  unlockBody,
  useExampleBody,
  useTemplateBody,
} from "@sofa/shared";
import { EXAMPLES, type ExampleSpace, type WidgetDef } from "@sofa/widgets";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import type { z } from "zod";
import {
  bearerToken,
  createRateLimiter,
  hashPassword,
  signSpaceToken,
  verifyPassword,
  verifySpaceToken,
} from "./auth";
import type { Config } from "./config";
import type { Db, SpaceRow } from "./db";
import { downloadHeaders, FileError, type Files } from "./files";
import type { LinkPreviewer } from "./links";
import type { AiService, SpaceDocs } from "./types";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Adds the configured analytics script to the app shell, before `</head>`. */
export function injectAnalytics(
  html: string,
  analytics: { src: string; websiteId: string },
): string {
  const tag = `<script defer src="${escapeAttribute(analytics.src)}" data-website-id="${escapeAttribute(analytics.websiteId)}"></script>`;
  const at = html.indexOf("</head>");
  return at === -1 ? `${tag}${html}` : `${html.slice(0, at)}${tag}\n${html.slice(at)}`;
}

export type RateLimits = {
  /** unlock attempts per space and client address */
  unlock: { limit: number; windowMs: number };
  /** generate requests per space */
  generate: { limit: number; windowMs: number };
  /** link previews per space */
  links: { limit: number; windowMs: number };
  /** spaces created per client address */
  createSpace: { limit: number; windowMs: number };
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  unlock: { limit: 10, windowMs: 10 * 60_000 },
  generate: { limit: 10, windowMs: 60_000 },
  links: { limit: 30, windowMs: 60_000 },
  createSpace: { limit: 30, windowMs: 60_000 },
};

export type AppDeps = {
  config: Config;
  db: Db;
  secret: Buffer;
  docs: SpaceDocs;
  files: Files;
  ai: AiService;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
  widgets: WidgetDef<any>[];
  preview: LinkPreviewer;
  rateLimits?: Partial<RateLimits>;
  /** example spaces offered on the landing page (default: the built-in catalog) */
  examples?: ExampleSpace[];
};

type Env = { Bindings: Partial<HttpBindings> };
type Ctx = Context<Env>;

const JSON_BODY_BYTES = 64 * 1024;
/** an exported document may be up to 20 MB of base64, plus the JSON around it */
const IMPORT_BODY_BYTES = 20 * 1024 * 1024 + 64 * 1024;
/** what an imported document may hold; far above anything a real space reaches */
const IMPORT_CAPS = { tools: 200, chat: 5000, materials: 2000 } as const;
const SPACE_ROOTS = new Set(["meta", "materials", "chat", "tools"]);

/** multipart framing on top of the file itself */
const UPLOAD_BODY_BYTES = LIMITS.fileBytes + 64 * 1024;

const STATIC_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
};

function fail(status: 400 | 401 | 403 | 404 | 409 | 413 | 429, message: string): never {
  throw new HTTPException(status, { message });
}

/**
 * The address rate limits are keyed on. Behind `trustedHops` reverse proxies the socket
 * belongs to the nearest proxy, so the client is taken from X-Forwarded-For: each trusted
 * proxy appends the address it saw, and entries further left can be forged by the client.
 */
export function clientAddress(c: Ctx, trustedHops = 0): string {
  const socket = c.env?.incoming?.socket?.remoteAddress ?? "unknown";
  if (trustedHops <= 0) return socket;
  const chain = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - trustedHops] ?? chain[0] ?? socket;
}

async function readJson<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    fail(400, `Invalid request: ${where}${issue?.message ?? "invalid body"}`);
  }
  return parsed.data;
}

function spaceInfo(space: SpaceRow): SpaceInfo {
  return {
    id: space.id,
    title: space.title,
    createdAt: space.createdAt,
    locked: space.passwordHash !== null,
  };
}

/** File name part of an export: lower-case words joined by dashes. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "space";
}

/**
 * Decode an exported document into a fresh Y.Doc and check that it looks like a space:
 * only the known shared types, of the right kinds, nothing pending, sane sizes.
 * Returns null for anything else.
 */
export function decodeSpaceDoc(base64: string): Y.Doc | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) return null;
  const update = new Uint8Array(Buffer.from(base64, "base64"));
  if (update.length === 0) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    // Missing dependencies mean the bytes are not a whole document.
    if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) throw new Error();
    for (const name of doc.share.keys()) if (!SPACE_ROOTS.has(name)) throw new Error();
    const meta = metaMap(doc);
    if (typeof meta.get("title") !== "string") throw new Error();
    const tools = toolsMap(doc);
    const materials = materialsArray(doc);
    const chat = chatArray(doc);
    // A root written as another kind of type keeps its content where this one does not look.
    if (meta._start !== null || tools._start !== null) throw new Error();
    if (materials._map.size > 0 || chat._map.size > 0) throw new Error();
    if (tools.size > IMPORT_CAPS.tools) throw new Error();
    if (materials.length > IMPORT_CAPS.materials) throw new Error();
    if (chat.length > IMPORT_CAPS.chat) throw new Error();
    for (const [id, tool] of tools.entries()) {
      if (!(tool instanceof Y.Map) || tool.get("id") !== id) throw new Error();
      const state = tool.get("state");
      if (state !== undefined && !(state instanceof Y.Map)) throw new Error();
    }
    for (const list of [materials.toArray(), chat.toArray()] as unknown[][]) {
      for (const item of list) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error();
        if (item instanceof Y.AbstractType) throw new Error();
      }
    }
    return doc;
  } catch {
    doc.destroy();
    return null;
  }
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config, db, secret, docs, files, ai, widgets, preview } = deps;
  const examples = deps.examples ?? EXAMPLES;
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...deps.rateLimits };
  const unlockLimiter = createRateLimiter(limits.unlock.limit, limits.unlock.windowMs);
  const generateLimiter = createRateLimiter(limits.generate.limit, limits.generate.windowMs);
  const linkLimiter = createRateLimiter(limits.links.limit, limits.links.windowMs);
  const createLimiter = createRateLimiter(limits.createSpace.limit, limits.createSpace.windowMs);

  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message || "Request failed" }, error.status);
    if (error instanceof FileError) return c.json({ error: error.message }, error.status);
    console.error(
      "[sofa] request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use("/api/*", async (c, next) => {
    await next();
    const headers = c.res.headers;
    const defaults: Record<string, string> = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
    };
    for (const [name, value] of Object.entries(defaults)) {
      if (!headers.has(name)) headers.set(name, value);
    }
  });

  const tooLarge = (c: Context) => c.json({ error: "Request body is too large" }, 413);
  const jsonLimit = bodyLimit({ maxSize: JSON_BODY_BYTES, onError: tooLarge });
  const uploadLimit = bodyLimit({
    maxSize: UPLOAD_BODY_BYTES,
    onError: (c) => c.json({ error: "The file is too large" }, 413),
  });

  function findSpace(c: Ctx): SpaceRow {
    const id = c.req.param("id") ?? "";
    const space = isSpaceId(id) ? db.getSpace(id) : null;
    if (!space) fail(404, "Space not found");
    return space;
  }

  /** The space of the route; locked spaces need a valid bearer token. */
  function openSpace(c: Ctx): SpaceRow {
    const space = findSpace(c);
    if (space.passwordHash !== null) {
      const token = bearerToken(c.req.header("Authorization"));
      if (!verifySpaceToken(secret, space.id, token)) fail(401, "This space is locked");
    }
    return space;
  }

  app.get("/api/config", (c) => {
    const info = ai.enabled ? ai.info() : null;
    const body: ServerConfig = {
      aiEnabled: ai.enabled,
      provider: info?.provider ?? null,
      model: info?.model ?? null,
      templates: widgets.map((def) => ({
        id: def.type,
        title: def.title || def.starter.title,
        description: def.description || def.starter.description,
      })),
      examples: examples.map((example) => ({
        id: example.id,
        title: example.title,
        description: example.description,
      })),
      demo: config.demo,
      spaceTtlHours: config.spaceTtlHours,
    };
    return c.json(body);
  });

  function limitCreate(c: Ctx) {
    if (!createLimiter.hit(clientAddress(c, deps.config.trustProxyHops)))
      fail(429, "Too many spaces created, try again later");
  }

  /** Insert a space row; the response carries a token when it is locked. */
  async function newSpace(title: string, password?: string): Promise<SpaceInfo> {
    const space: SpaceRow = {
      id: newSpaceId(),
      title,
      createdAt: Date.now(),
      passwordHash: password === undefined ? null : await hashPassword(password),
    };
    db.createSpace(space);
    const info = spaceInfo(space);
    if (info.locked) info.token = signSpaceToken(secret, space.id);
    return info;
  }

  app.post("/api/spaces", jsonLimit, async (c) => {
    limitCreate(c);
    const body = await readJson(c, createSpaceBody);
    return c.json(await newSpace(body.title, body.password), 201);
  });

  app.post("/api/examples/:exampleId", jsonLimit, async (c) => {
    const example = examples.find((item) => item.id === c.req.param("exampleId"));
    if (!example) fail(404, "Example not found");
    const body = await readJson(c, useExampleBody);
    limitCreate(c);
    const info = await newSpace(example.title);
    await docs.transact(info.id, (doc) => {
      const now = Date.now();
      for (const [index, tool] of example.tools.entries()) {
        const record: ToolRecord = {
          id: newId(),
          title: tool.title,
          description: tool.description,
          kind: "widget",
          widgetType: tool.widgetType,
          config: tool.config,
          html: "",
          status: "ready",
          version: 1,
          order: index + 1,
          span: tool.span ?? 1,
          createdBy: body.user.id,
          createdAt: now + index,
          updatedAt: now + index,
        };
        putTool(doc, record, tool.state);
      }
      const materials = (example.materials ?? []).map(
        (material, index): Material => ({
          id: newId(),
          kind: material.kind,
          ...(material.text !== undefined ? { text: material.text } : {}),
          ...(material.url !== undefined ? { url: material.url } : {}),
          ...(material.title !== undefined ? { title: material.title } : {}),
          authorId: example.author.id,
          authorName: example.author.name,
          createdAt: now + index,
        }),
      );
      if (materials.length > 0) materialsArray(doc).push(materials);
    });
    return c.json(info, 201);
  });

  app.get("/api/spaces/:id/export", async (c) => {
    const space = openSpace(c);
    const { title, update } = await docs.read(space.id, (doc) => {
      const meta = metaMap(doc).get("title");
      return {
        title: typeof meta === "string" && meta.trim() ? meta.trim() : space.title,
        update: Y.encodeStateAsUpdate(doc),
      };
    });
    const body: SpaceExport = {
      format: SPACE_EXPORT_FORMAT,
      version: SPACE_EXPORT_VERSION,
      title: title.slice(0, LIMITS.titleLength),
      exportedAt: Date.now(),
      doc: Buffer.from(update).toString("base64"),
    };
    c.header("Content-Disposition", `attachment; filename="${slugify(title)}.sofa.json"`);
    return c.json(body);
  });

  const importLimit = bodyLimit({
    maxSize: IMPORT_BODY_BYTES,
    onError: (c) => c.json({ error: "The export is too large" }, 413),
  });

  app.post("/api/import", importLimit, async (c) => {
    limitCreate(c);
    const body = await readJson(c, importBody);
    const doc = decodeSpaceDoc(body.doc);
    if (!doc) fail(400, "This file is not a Sofa space export");
    try {
      const info = await newSpace(body.title, body.password);
      doc.transact(() => {
        const meta = metaMap(doc);
        meta.set("title", info.title);
        meta.set("createdAt", info.createdAt);
        meta.set("locked", info.locked);
        // Uploaded files stay on the old server; keep the names, drop the references.
        const materials = materialsArray(doc);
        const items = materials.toArray();
        for (let index = items.length - 1; index >= 0; index--) {
          const item = items[index];
          if (item?.kind !== "file" || item.fileId === undefined) continue;
          const { fileId: _dropped, ...rest } = item;
          materials.delete(index, 1);
          materials.insert(index, [rest]);
        }
      });
      // Written before anyone connects, so the first collab load starts from it.
      db.saveDoc(info.id, Y.encodeStateAsUpdate(doc));
      return c.json(info, 201);
    } finally {
      doc.destroy();
    }
  });

  app.get("/api/spaces/:id", (c) => c.json(spaceInfo(findSpace(c))));

  app.post("/api/spaces/:id/unlock", jsonLimit, async (c) => {
    const space = findSpace(c);
    const body = await readJson(c, unlockBody);
    if (space.passwordHash === null) fail(400, "This space has no password");
    const key = `${space.id}|${clientAddress(c, deps.config.trustProxyHops)}`;
    if (!unlockLimiter.hit(key)) fail(429, "Too many attempts, try again later");
    if (!(await verifyPassword(body.password, space.passwordHash))) fail(403, "Wrong password");
    unlockLimiter.reset(key);
    const response: UnlockResponse = { token: signSpaceToken(secret, space.id) };
    return c.json(response);
  });

  app.post("/api/spaces/:id/generate", jsonLimit, async (c) => {
    const space = openSpace(c);
    const body = await readJson(c, generateBody);
    if (!generateLimiter.hit(space.id)) fail(429, "Too many requests, wait a moment and try again");
    const result = await ai.generate(space.id, body);
    const response: GenerateResponse = { messageId: result.messageId };
    return c.json(response, 202);
  });

  app.post("/api/spaces/:id/templates/:templateId", jsonLimit, async (c) => {
    const space = openSpace(c);
    const def = widgets.find((widget) => widget.type === c.req.param("templateId"));
    if (!def) fail(404, "Template not found");
    const body = await readJson(c, useTemplateBody);
    const toolId = newId();
    await docs.transact(space.id, (doc) => {
      const now = Date.now();
      const record: ToolRecord = {
        id: toolId,
        title: def.starter.title,
        description: def.starter.description,
        kind: "widget",
        widgetType: def.type,
        config: def.starter.config,
        html: "",
        status: "ready",
        version: 1,
        order: nextToolOrder(doc),
        span: 1,
        createdBy: body.user.id,
        createdAt: now,
        updatedAt: now,
      };
      putTool(doc, record, def.starter.initialState ?? {});
    });
    const response: UseTemplateResponse = { toolId };
    return c.json(response, 201);
  });

  app.post("/api/spaces/:id/files", uploadLimit, async (c) => {
    const space = openSpace(c);
    const declared = Number(c.req.header("Content-Length"));
    if (Number.isFinite(declared) && declared > UPLOAD_BODY_BYTES)
      fail(413, "The file is too large");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      fail(400, "Expected a multipart form with a file");
    }
    const upload = form.get("file");
    if (!(upload instanceof File)) fail(400, 'Missing form field "file"');
    if (upload.size > LIMITS.fileBytes) fail(413, "The file is too large");
    const stored = await files.save(space.id, {
      name: upload.name,
      mime: upload.type,
      data: new Uint8Array(await upload.arrayBuffer()),
    });
    const info: FileInfo = {
      fileId: stored.fileId,
      name: stored.name,
      mime: stored.mime,
      size: stored.size,
      url: `/api/files/${stored.fileId}`,
    };
    return c.json(info, 201);
  });

  app.get("/api/files/:fileId", async (c) => {
    const file = files.get(c.req.param("fileId"));
    const space = file ? db.getSpace(file.spaceId) : null;
    if (!file || !space) fail(404, "File not found");
    if (space.passwordHash !== null) {
      const token = c.req.query("t") ?? bearerToken(c.req.header("Authorization"));
      if (!verifySpaceToken(secret, space.id, token)) fail(401, "This space is locked");
    }
    const stat = await fsp.stat(file.path).catch(() => null);
    if (!stat?.isFile()) fail(404, "File not found");
    const body = Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: downloadHeaders({ ...file, size: stat.size }),
    });
  });

  app.post("/api/spaces/:id/links", jsonLimit, async (c) => {
    const space = openSpace(c);
    const body = await readJson(c, linkBody);
    let found: LinkPreview = { url: body.url, title: "", description: "" };
    // Over the limit the link is still accepted, just without a preview.
    if (linkLimiter.hit(space.id)) found = await preview(body.url);
    return c.json(found);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  const webDir = path.resolve(config.webDir);
  const indexFile = path.join(webDir, "index.html");

  async function sendStatic(c: Ctx, file: string, cache: string): Promise<Response | null> {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    const headers: Record<string, string> = {
      "Content-Type": STATIC_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    if (c.req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers,
    });
  }

  app.get("*", async (c) => {
    const pathname = c.req.path;
    if (pathname === COLLAB_PATH || pathname.startsWith(`${COLLAB_PATH}/`)) {
      return c.json({ error: "Not found" }, 404);
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
    if (decoded.includes("\0")) return c.json({ error: "Not found" }, 404);
    // Normalizing against the root first removes any ".." before the path touches webDir.
    const relative = path.posix.normalize(`/${decoded.replaceAll("\\", "/")}`);
    const file = path.join(webDir, relative);
    if (relative !== "/" && relative !== "/index.html" && file.startsWith(webDir + path.sep)) {
      const hashed = relative.startsWith("/assets/");
      const found = await sendStatic(
        c,
        file,
        hashed ? "public, max-age=31536000, immutable" : "no-cache",
      );
      if (found) return found;
      // A missing asset must not be answered with the app shell.
      if (path.extname(relative) !== "") return c.json({ error: "Not found" }, 404);
    }
    if (!config.analytics) {
      const shell = await sendStatic(c, indexFile, "no-cache");
      return shell ?? c.json({ error: "Not found" }, 404);
    }
    const html = await fsp.readFile(indexFile, "utf8").catch(() => null);
    if (html === null) return c.json({ error: "Not found" }, 404);
    const body = injectAnalytics(html, config.analytics);
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    return new Response(c.req.method === "HEAD" ? null : body, { status: 200, headers });
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
