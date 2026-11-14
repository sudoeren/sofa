import {
  type JsonValue,
  readTool,
  TOOL_FIELDS,
  TOOL_LIMITS,
  type ToolRecord,
  type ToolState,
  toolStateMap,
  toolsMap,
} from "@sofa/shared";
import * as Y from "yjs";
import { checkJsonValue, checkKey } from "./guard";

export type WriteResult = { ok: true } | { ok: false; reason: string };

/** `keys` is null when the whole state was replaced (tool or state map appeared or changed). */
export type StateChange = { keys: string[] | null; origin: unknown };

const EMPTY_STATE: ToolState = Object.freeze({}) as ToolState;

function toPlain(value: unknown): JsonValue {
  if (value === null || typeof value !== "object") return value as JsonValue;
  // Yjs hands back the very object it stores; copy so readers cannot mutate the document.
  const source =
    typeof (value as { toJSON?: unknown }).toJSON === "function"
      ? (value as { toJSON(): unknown }).toJSON()
      : value;
  return JSON.parse(JSON.stringify(source)) as JsonValue;
}

function sameRecord(a: ToolRecord | null, b: ToolRecord | null): boolean {
  if (a === null || b === null) return a === b;
  for (const field of TOOL_FIELDS) if (a[field] !== b[field]) return false;
  return true;
}

/**
 * One tool's record and state, observed from the Y.Doc. It is the only place the runtime
 * reads or writes tool state, so widgets and frames go through the same guarded path.
 *
 * Observers are attached while someone is subscribed. It follows the tool being added,
 * removed or replaced and the nested `state` map being created or replaced later.
 */
export class ToolStore {
  private readonly tools: Y.Map<Y.Map<unknown>>;
  private tool: Y.Map<unknown> | null = null;
  private stateMap: Y.Map<JsonValue> | null = null;
  private state: ToolState = EMPTY_STATE;
  private record: ToolRecord | null = null;
  private attached = false;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<(change: StateChange) => void>();

  constructor(
    readonly doc: Y.Doc,
    readonly toolId: string,
  ) {
    this.tools = toolsMap(doc);
  }

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.attach();
    return () => {
      this.listeners.delete(listener);
      this.detachIfIdle();
    };
  };

  /** Per-key change feed with the transaction origin, used by the frame host. */
  onChange(listener: (change: StateChange) => void): () => void {
    this.changeListeners.add(listener);
    this.attach();
    return () => {
      this.changeListeners.delete(listener);
      this.detachIfIdle();
    };
  }

  getState = (): ToolState => {
    if (!this.attached) this.refresh();
    return this.state;
  };

  getRecord = (): ToolRecord | null => {
    if (!this.attached) this.refresh();
    return this.record;
  };

  /** Authoritative value of one key, straight from the document. */
  peek(key: string): JsonValue | undefined {
    const state = this.currentStateMap();
    const value = state?.get(key);
    return value === undefined ? undefined : toPlain(value);
  }

  set = (key: string, value: JsonValue): void => {
    const result = this.write(key, value);
    if (!result.ok) console.warn(`[sofa] state.set("${String(key)}") rejected: ${result.reason}`);
  };

  del = (key: string): void => {
    this.remove(key);
  };

  write(key: unknown, value: unknown, origin?: unknown): WriteResult {
    if (!checkKey(key)) return { ok: false, reason: "invalid key" };
    const checked = checkJsonValue(value);
    if (!checked.ok) return checked;
    const tool = this.tools.get(this.toolId);
    if (!tool) return { ok: false, reason: "tool does not exist" };
    const state = this.currentStateMap();
    if (state) {
      const current = state.get(key);
      if (current === undefined) {
        if (state.size >= TOOL_LIMITS.maxKeys) return { ok: false, reason: "too many keys" };
      } else if (JSON.stringify(current) === checked.json) {
        return { ok: true }; // unchanged: do not grow the document
      }
    }
    this.doc.transact(() => {
      toolStateMap(tool).set(key, checked.value);
    }, origin);
    return { ok: true };
  }

  remove(key: unknown, origin?: unknown): WriteResult {
    if (!checkKey(key)) return { ok: false, reason: "invalid key" };
    const state = this.currentStateMap();
    if (!state?.has(key)) return { ok: true };
    this.doc.transact(() => {
      state.delete(key);
    }, origin);
    return { ok: true };
  }

  private currentStateMap(): Y.Map<JsonValue> | null {
    const state = this.tools.get(this.toolId)?.get("state");
    return state instanceof Y.Map ? (state as Y.Map<JsonValue>) : null;
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.tools.observe(this.onTools);
    this.bind();
  }

  private detachIfIdle(): void {
    if (!this.attached || this.listeners.size > 0 || this.changeListeners.size > 0) return;
    this.attached = false;
    this.tools.unobserve(this.onTools);
    this.tool?.unobserve(this.onTool);
    this.stateMap?.unobserve(this.onState);
    this.tool = null;
    this.stateMap = null;
  }

  /** Point the observers at the current tool and state maps and rebuild both snapshots. */
  private bind(): void {
    const tool = this.tools.get(this.toolId) ?? null;
    if (tool !== this.tool) {
      this.tool?.unobserve(this.onTool);
      this.tool = tool;
      tool?.observe(this.onTool);
    }
    const stateMap = this.currentStateMap();
    if (stateMap !== this.stateMap) {
      this.stateMap?.unobserve(this.onState);
      this.stateMap = stateMap;
      stateMap?.observe(this.onState);
    }
    this.refresh();
  }

  /** Recompute the snapshots, keeping the old objects when nothing differs. */
  private refresh(): void {
    const tool = this.tools.get(this.toolId);
    const record = tool ? readTool(tool) : null;
    if (!sameRecord(record, this.record)) this.record = record;

    const stateMap = this.currentStateMap();
    if (!stateMap || stateMap.size === 0) {
      this.state = EMPTY_STATE;
      return;
    }
    const next: ToolState = {};
    for (const [key, value] of stateMap.entries()) next[key] = toPlain(value);
    if (JSON.stringify(next) !== JSON.stringify(this.state)) this.state = Object.freeze(next);
  }

  private readonly onTools = (event: Y.YMapEvent<Y.Map<unknown>>): void => {
    if (!event.keysChanged.has(this.toolId)) return;
    this.bind();
    this.emit({ keys: null, origin: event.transaction.origin });
  };

  private readonly onTool = (event: Y.YMapEvent<unknown>): void => {
    if (event.keysChanged.has("state")) {
      this.bind();
      this.emit({ keys: null, origin: event.transaction.origin });
      return;
    }
    const record = this.tool ? readTool(this.tool) : null;
    if (!sameRecord(record, this.record)) this.record = record;
    this.notify();
  };

  private readonly onState = (event: Y.YMapEvent<JsonValue>): void => {
    const map = this.stateMap;
    if (!map) return;
    const keys = [...event.keysChanged];
    const next: ToolState = { ...this.state };
    for (const key of keys) {
      const value = map.get(key);
      if (value === undefined) delete next[key];
      else next[key] = toPlain(value);
    }
    this.state = Object.keys(next).length === 0 ? EMPTY_STATE : Object.freeze(next);
    this.emit({ keys, origin: event.transaction.origin });
  };

  private emit(change: StateChange): void {
    for (const listener of [...this.changeListeners]) listener(change);
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
