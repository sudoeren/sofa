import * as Y from "yjs";

/**
 * A space is one Y.Doc. Its document name on the collab socket is the space id.
 *
 *   meta       Y.Map    { title: string, createdAt: number, locked: boolean }
 *   materials  Y.Array  Material (plain JSON objects)
 *   chat       Y.Array  ChatMessage (plain JSON objects)
 *   tools      Y.Map    toolId -> Y.Map (ToolRecord fields + "state": Y.Map)
 *
 * Tool state is a flat Y.Map of JSON values. Each top-level key is last-write-wins,
 * so tools store one key per independently edited thing ("vote:<userId>", "item:<id>").
 */

export type MemberInfo = { id: string; name: string; color: string };

export type MaterialKind = "note" | "link" | "file";

export type Material = {
  id: string;
  kind: MaterialKind;
  /** note body, or optional caption for links and files */
  text?: string;
  url?: string;
  title?: string;
  description?: string;
  fileId?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  authorId: string;
  authorName: string;
  createdAt: number;
};

export type ChatRole = "user" | "assistant";
export type ChatStatus = "pending" | "done" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  authorId?: string;
  authorName?: string;
  /** tool created or changed by this message */
  toolId?: string;
  status: ChatStatus;
  createdAt: number;
};

export type ToolStatus = "generating" | "ready" | "error";

/**
 * widget: a built-in component (packages/widgets) rendered natively from `config`.
 * html: a generated HTML document rendered in a sandboxed frame.
 * Both kinds keep their shared data in the same `state` map.
 */
export type ToolKind = "widget" | "html";

/** Fields stored on a tool's Y.Map, next to the nested "state" Y.Map. */
export type ToolRecord = {
  id: string;
  title: string;
  description: string;
  kind: ToolKind;
  /** widget kind: type id from the widget catalog */
  widgetType?: string;
  /** widget kind: configuration validated against the widget's schema */
  config?: JsonValue;
  /** html kind: complete HTML document for the sandboxed frame; empty otherwise */
  html: string;
  status: ToolStatus;
  error?: string;
  /** bumped on every html change so frames know to reload */
  version: number;
  /** sort key in the grid, ascending */
  order: number;
  /** grid width in columns: 1 or 2 */
  span: 1 | 2;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolState = Record<string, JsonValue>;

export const TOOL_FIELDS = [
  "id",
  "title",
  "description",
  "kind",
  "widgetType",
  "config",
  "html",
  "status",
  "error",
  "version",
  "order",
  "span",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const;

export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}

export function materialsArray(doc: Y.Doc): Y.Array<Material> {
  return doc.getArray<Material>("materials");
}

export function chatArray(doc: Y.Doc): Y.Array<ChatMessage> {
  return doc.getArray<ChatMessage>("chat");
}

export function toolsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("tools");
}

export function toolStateMap(tool: Y.Map<unknown>): Y.Map<JsonValue> {
  let state = tool.get("state") as Y.Map<JsonValue> | undefined;
  if (!state) {
    state = new Y.Map<JsonValue>();
    tool.set("state", state);
  }
  return state;
}

export function readTool(tool: Y.Map<unknown>): ToolRecord {
  const out: Record<string, unknown> = {};
  for (const key of TOOL_FIELDS) {
    const value = tool.get(key);
    if (value !== undefined) out[key] = value;
  }
  return out as ToolRecord;
}

export function readToolState(tool: Y.Map<unknown>): ToolState {
  const state = tool.get("state") as Y.Map<JsonValue> | undefined;
  return state ? (state.toJSON() as ToolState) : {};
}

export function listTools(doc: Y.Doc): ToolRecord[] {
  const out: ToolRecord[] = [];
  for (const tool of toolsMap(doc).values()) out.push(readTool(tool));
  return out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function nextToolOrder(doc: Y.Doc): number {
  let max = 0;
  for (const tool of toolsMap(doc).values()) {
    const order = tool.get("order");
    if (typeof order === "number" && order > max) max = order;
  }
  return max + 1;
}

/** Insert a tool. Call inside doc.transact. */
export function putTool(doc: Y.Doc, record: ToolRecord, initialState: ToolState = {}): Y.Map<unknown> {
  const tool = new Y.Map<unknown>();
  toolsMap(doc).set(record.id, tool);
  for (const key of TOOL_FIELDS) {
    const value = record[key];
    if (value !== undefined) tool.set(key, value);
  }
  const state = new Y.Map<JsonValue>();
  tool.set("state", state);
  for (const [key, value] of Object.entries(initialState)) state.set(key, value);
  return tool;
}

/** Patch tool fields. Call inside doc.transact. Returns false when the tool is gone. */
export function patchTool(doc: Y.Doc, id: string, patch: Partial<ToolRecord>): boolean {
  const tool = toolsMap(doc).get(id);
  if (!tool) return false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) tool.delete(key);
    else tool.set(key, value);
  }
  return true;
}

/** Replace a chat message by id. Call inside doc.transact. */
export function patchChatMessage(doc: Y.Doc, id: string, patch: Partial<ChatMessage>): boolean {
  const chat = chatArray(doc);
  const items = chat.toArray();
  const index = items.findIndex((m) => m.id === id);
  const current = items[index];
  if (index < 0 || !current) return false;
  chat.delete(index, 1);
  chat.insert(index, [{ ...current, ...patch }]);
  return true;
}
