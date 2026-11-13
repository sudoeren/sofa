import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SpaceRow = {
  id: string;
  title: string;
  createdAt: number;
  passwordHash: string | null;
};

export type FileRow = {
  id: string;
  spaceId: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  createdAt: number;
};

export type Db = {
  createSpace(space: SpaceRow): void;
  getSpace(id: string): SpaceRow | null;
  loadDoc(spaceId: string): Uint8Array | null;
  saveDoc(spaceId: string, state: Uint8Array): void;
  insertFile(file: FileRow): void;
  getFile(id: string): FileRow | null;
  countFiles(spaceId: string): number;
  close(): void;
};

type RawSpace = { id: string; title: string; created_at: number; password_hash: string | null };
type RawFile = {
  id: string;
  space_id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: number;
};

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "sofra.db");
  const db = new DatabaseSync(file);
  // Holds password hashes and every document; SQLite gives the WAL files the same mode.
  fs.chmodSync(file, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      password_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS docs (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      state BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS files_space ON files(space_id);
  `);

  const insertSpace = db.prepare(
    "INSERT INTO spaces (id, title, created_at, password_hash) VALUES (?, ?, ?, ?)",
  );
  const selectSpace = db.prepare("SELECT id, title, created_at, password_hash FROM spaces WHERE id = ?");
  const selectDoc = db.prepare("SELECT state FROM docs WHERE space_id = ?");
  const upsertDoc = db.prepare(
    `INSERT INTO docs (space_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(space_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  const insertFile = db.prepare(
    "INSERT INTO files (id, space_id, name, mime, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const selectFile = db.prepare(
    "SELECT id, space_id, name, mime, size, path, created_at FROM files WHERE id = ?",
  );
  const countFiles = db.prepare("SELECT COUNT(*) AS n FROM files WHERE space_id = ?");

  let closed = false;

  return {
    createSpace(space) {
      insertSpace.run(space.id, space.title, space.createdAt, space.passwordHash);
    },
    getSpace(id) {
      const row = selectSpace.get(id) as RawSpace | undefined;
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        createdAt: Number(row.created_at),
        passwordHash: row.password_hash,
      };
    },
    loadDoc(spaceId) {
      const row = selectDoc.get(spaceId) as { state: Uint8Array } | undefined;
      return row ? new Uint8Array(row.state) : null;
    },
    saveDoc(spaceId, state) {
      upsertDoc.run(spaceId, state, Date.now());
    },
    insertFile(file) {
      insertFile.run(file.id, file.spaceId, file.name, file.mime, file.size, file.path, file.createdAt);
    },
    getFile(id) {
      const row = selectFile.get(id) as RawFile | undefined;
      if (!row) return null;
      return {
        id: row.id,
        spaceId: row.space_id,
        name: row.name,
        mime: row.mime,
        size: Number(row.size),
        path: row.path,
        createdAt: Number(row.created_at),
      };
    },
    countFiles(spaceId) {
      const row = countFiles.get(spaceId) as { n: number } | undefined;
      return Number(row?.n ?? 0);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

/** Random 32 byte server secret, created on first start and kept readable by the owner only. */
export function loadSecret(dataDir: string): Buffer {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "secret");
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32);
  fs.writeFileSync(file, secret, { mode: 0o600 });
  // The mode option is masked by umask and ignored when the file already existed.
  fs.chmodSync(file, 0o600);
  return secret;
}
