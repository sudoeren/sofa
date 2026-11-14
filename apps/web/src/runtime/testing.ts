import { putTool, type ToolRecord, type ToolState } from "@sofra/shared";
import * as Y from "yjs";

/** Test helpers for the runtime. Not exported from index.ts. */

export function makeRecord(patch: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: "t1",
    title: "Tool",
    description: "",
    kind: "html",
    html: "",
    status: "ready",
    version: 1,
    order: 1,
    span: 1,
    createdBy: "u1",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

export function addTool(doc: Y.Doc, patch: Partial<ToolRecord> = {}, state: ToolState = {}): void {
  doc.transact(() => {
    putTool(doc, makeRecord(patch), state);
  });
}

/** Two documents that exchange every update, like two members of a space. */
export function syncedDocs(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "from-b") Y.applyUpdate(b, update, "from-a");
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "from-a") Y.applyUpdate(a, update, "from-b");
  });
  return [a, b];
}
