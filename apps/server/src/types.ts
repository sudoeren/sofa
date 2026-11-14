import type { GenerateBody } from "@sofa/shared";
import type * as Y from "yjs";

/**
 * Seams between the server core (src/*.ts) and the AI service (src/ai/**).
 * The core implements SpaceDocs and FileStore; the AI service implements AiService.
 */

export interface SpaceDocs {
  /**
   * Run fn against the live document of a space inside one Yjs transaction.
   * Changes reach every connected client and are persisted. Rejects when the space
   * does not exist.
   */
  transact<T>(spaceId: string, fn: (doc: Y.Doc) => T): Promise<T>;
  /** Read from the live document without writing. */
  read<T>(spaceId: string, fn: (doc: Y.Doc) => T): Promise<T>;
}

export type StoredFile = {
  fileId: string;
  spaceId: string;
  name: string;
  mime: string;
  size: number;
  /** absolute path on disk */
  path: string;
};

export interface FileStore {
  get(fileId: string): StoredFile | null;
  /** UTF-8 text of a file when it is a text type and small enough, else null. */
  readText(fileId: string, maxBytes: number): Promise<string | null>;
}

export type AiInfo = { provider: string; model: string };

export interface AiService {
  /**
   * false when the host configured no provider. generate() still works when the request
   * carries the member's own key (body.ai); with neither it only matches starter templates.
   */
  readonly enabled: boolean;
  info(): AiInfo | null;
  /**
   * Handle one request from a member. Must not throw: it appends the user message and a
   * pending assistant message to chat, returns the assistant message id right away, and
   * finishes in the background (creating or changing a tool, then marking the assistant
   * message done or error).
   */
  generate(spaceId: string, body: GenerateBody): Promise<{ messageId: string }>;
}

export type AiDeps = { docs: SpaceDocs; files: FileStore };
