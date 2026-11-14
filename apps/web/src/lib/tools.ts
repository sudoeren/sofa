import { LIMITS, metaMap, patchTool, toolsMap } from "@sofa/shared";
import type * as Y from "yjs";

/** Edits the shell makes to tool records and space meta. Each one is a single transaction. */

function orderedIds(doc: Y.Doc): string[] {
  const rows: { id: string; order: number; createdAt: number }[] = [];
  for (const [id, tool] of toolsMap(doc)) {
    const order = tool.get("order");
    const createdAt = tool.get("createdAt");
    rows.push({
      id,
      order: typeof order === "number" ? order : 0,
      createdAt: typeof createdAt === "number" ? createdAt : 0,
    });
  }
  rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  return rows.map((row) => row.id);
}

function writeOrder(doc: Y.Doc, ids: string[]): void {
  const tools = toolsMap(doc);
  ids.forEach((id, index) => {
    const tool = tools.get(id);
    if (tool && tool.get("order") !== index + 1) tool.set("order", index + 1);
  });
}

export function setSpaceTitle(doc: Y.Doc, title: string): void {
  const cleaned = title.trim().slice(0, LIMITS.titleLength);
  if (!cleaned) return;
  doc.transact(() => metaMap(doc).set("title", cleaned));
}

export function renameTool(doc: Y.Doc, id: string, title: string): void {
  const cleaned = title.trim().slice(0, LIMITS.titleLength);
  if (!cleaned) return;
  doc.transact(() => patchTool(doc, id, { title: cleaned, updatedAt: Date.now() }));
}

export function setToolSpan(doc: Y.Doc, id: string, span: 1 | 2): void {
  doc.transact(() => patchTool(doc, id, { span }));
}

/** Move a tool one place earlier (-1) or later (+1). */
export function moveTool(doc: Y.Doc, id: string, direction: -1 | 1): void {
  doc.transact(() => {
    const ids = orderedIds(doc);
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    writeOrder(doc, ids);
  });
}

/** Move a tool to the position currently held by another tool. */
export function moveToolTo(doc: Y.Doc, id: string, targetId: string): void {
  if (id === targetId) return;
  doc.transact(() => {
    const ids = orderedIds(doc);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    writeOrder(doc, ids);
  });
}

export function deleteTool(doc: Y.Doc, id: string): void {
  doc.transact(() => toolsMap(doc).delete(id));
}
