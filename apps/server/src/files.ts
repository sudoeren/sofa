import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "@sofra/shared";
import { nanoid } from "nanoid";
import type { Db, FileRow } from "./db";
import type { FileStore, StoredFile } from "./types";

/** Raster image types a browser may render inline. SVG is left out: it can carry script. */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/** Types that a browser could execute or render as a document; served as opaque bytes. */
const ACTIVE_TYPE = /(html|xml|svg|javascript|ecmascript)/;

const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);
const TEXT_MIME_TYPES = new Set(["application/json", "application/x-ndjson"]);

const MAX_NAME_LENGTH = 120;

export class FileError extends Error {
  constructor(
    readonly status: 400 | 409 | 413,
    message: string,
  ) {
    super(message);
  }
}

/** Reduce a client supplied file name to a safe base name. */
export function sanitizeFileName(input: string): string {
  let name = input.normalize("NFC");
  // Keep only the last path segment, for both separator styles.
  name = name.split(/[\\/]/).pop() ?? "";
  name = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME_LENGTH - ext.length).trimEnd() + ext;
  }
  return name || "file";
}

export function normalizeMime(input: string | undefined | null): string {
  const value = (input ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(value)
    ? value
    : "application/octet-stream";
}

export function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE_TYPES.has(mime);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isTextLike(mime: string, name: string): boolean {
  if (isInlineImage(mime)) return false;
  return (
    mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime) || TEXT_EXTENSIONS.has(extensionOf(name))
  );
}

/** Response headers for a download. Only allow-listed images are shown inline. */
export function downloadHeaders(file: StoredFile): Record<string, string> {
  const inline = isInlineImage(file.mime);
  const type = inline
    ? file.mime
    : ACTIVE_TYPE.test(file.mime)
      ? "application/octet-stream"
      : file.mime;
  const fallback = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(file.name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    "Content-Type": type,
    "Content-Length": String(file.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=3600",
  };
}

export type Files = FileStore & {
  /** Store an upload. Throws FileError when a limit is exceeded. */
  save(
    spaceId: string,
    upload: { name: string; mime: string; data: Uint8Array },
  ): Promise<StoredFile>;
};

function toStored(row: FileRow): StoredFile {
  return {
    fileId: row.id,
    spaceId: row.spaceId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    path: row.path,
  };
}

export function createFiles(db: Db, dataDir: string): Files {
  const dir = path.join(dataDir, "files");
  fs.mkdirSync(dir, { recursive: true });

  function get(fileId: string): StoredFile | null {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
    const row = db.getFile(fileId);
    return row ? toStored(row) : null;
  }

  return {
    get,

    async readText(fileId, maxBytes) {
      const file = get(fileId);
      if (!file || file.size > maxBytes || !isTextLike(file.mime, file.name)) return null;
      try {
        const data = await fsp.readFile(file.path);
        if (data.length > maxBytes) return null;
        return data.toString("utf8");
      } catch {
        return null;
      }
    },

    async save(spaceId, upload) {
      if (upload.data.byteLength === 0) throw new FileError(400, "The file is empty");
      if (upload.data.byteLength > LIMITS.fileBytes)
        throw new FileError(413, "The file is too large");
      if (db.countFiles(spaceId) >= LIMITS.filesPerSpace) {
        throw new FileError(409, "This space has reached its file limit");
      }
      const id = nanoid();
      const row: FileRow = {
        id,
        spaceId,
        name: sanitizeFileName(upload.name),
        mime: normalizeMime(upload.mime),
        size: upload.data.byteLength,
        // The name on disk is the generated id; the client's name is only metadata.
        path: path.join(dir, id),
        createdAt: Date.now(),
      };
      await fsp.writeFile(row.path, upload.data, { mode: 0o600, flag: "wx" });
      try {
        db.insertFile(row);
      } catch (error) {
        await fsp.rm(row.path, { force: true });
        throw error;
      }
      return toStored(row);
    },
  };
}
