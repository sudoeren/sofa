import type { JsonValue, ToolRecord, ToolState } from "@sofa/shared";
import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { ToolStore } from "./store";

export type ToolStateApi = {
  /** immutable snapshot; a new object only when the state changed */
  data: ToolState;
  set: (key: string, value: JsonValue) => void;
  del: (key: string) => void;
};

/**
 * Shared state of one tool. Writes are checked against TOOL_LIMITS (key length, value
 * size, number of keys, JSON values only); a rejected write is dropped with a console
 * warning.
 */
export function useToolState(doc: Y.Doc, toolId: string): ToolStateApi {
  const store = useMemo(() => new ToolStore(doc, toolId), [doc, toolId]);
  const data = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => ({ data, set: store.set, del: store.del }), [data, store]);
}

/** The tool's record, or null while it does not exist. Re-renders when any field changes. */
export function useToolRecord(doc: Y.Doc, toolId: string): ToolRecord | null {
  const store = useMemo(() => new ToolStore(doc, toolId), [doc, toolId]);
  return useSyncExternalStore(store.subscribe, store.getRecord, store.getRecord);
}
