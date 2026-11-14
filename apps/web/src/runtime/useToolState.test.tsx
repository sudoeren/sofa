import { type JsonValue, patchTool, TOOL_LIMITS, toolsMap } from "@sofa/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { addTool, syncedDocs } from "./testing";
import { useToolRecord, useToolState } from "./useToolState";

describe("useToolState", () => {
  it("re-renders on a remote change and keeps the snapshot identity otherwise", () => {
    const [a, b] = syncedDocs();
    addTool(a, {}, { title: "Dinner" });
    const hookA = renderHook(() => useToolState(a, "t1"));
    const hookB = renderHook(() => useToolState(b, "t1"));
    expect(hookB.result.current.data).toEqual({ title: "Dinner" });

    const before = hookB.result.current.data;
    hookB.rerender();
    expect(hookB.result.current.data).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);

    act(() => hookA.result.current.set("vote:u1", { choice: 2 }));
    expect(hookB.result.current.data).toEqual({ title: "Dinner", "vote:u1": { choice: 2 } });
    expect(hookB.result.current.data).not.toBe(before);
    expect(hookA.result.current.data["vote:u1"]).toEqual({ choice: 2 });

    act(() => hookB.result.current.del("title"));
    expect(hookA.result.current.data).toEqual({ "vote:u1": { choice: 2 } });

    // an unrelated tool changing does not produce a new snapshot
    const stable = hookB.result.current.data;
    act(() => addTool(a, { id: "t2" }, { x: 1 }));
    expect(hookB.result.current.data).toBe(stable);
  });

  it("does not create a new snapshot for a write that changes nothing", () => {
    const doc = new Y.Doc();
    addTool(doc, {}, { n: { a: 1 } });
    const hook = renderHook(() => useToolState(doc, "t1"));
    const before = hook.result.current.data;
    const updates = vi.fn();
    doc.on("update", updates);
    act(() => hook.result.current.set("n", { a: 1 }));
    expect(updates).not.toHaveBeenCalled();
    expect(hook.result.current.data).toBe(before);
  });

  it("does not let callers alias stored values", () => {
    const doc = new Y.Doc();
    addTool(doc);
    const hook = renderHook(() => useToolState(doc, "t1"));
    const value = { list: [1, 2] };
    act(() => hook.result.current.set("k", value));
    value.list.push(3);
    expect(hook.result.current.data.k).toEqual({ list: [1, 2] });
    (hook.result.current.data.k as { list: number[] }).list.push(9);
    expect(toolsMap(doc).get("t1")?.get("state")).toBeInstanceOf(Y.Map);
    expect((toolsMap(doc).get("t1")?.get("state") as Y.Map<JsonValue>).get("k")).toEqual({
      list: [1, 2],
    });
  });

  it("enforces the limits on writes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Y.Doc();
    addTool(doc);
    const hook = renderHook(() => useToolState(doc, "t1"));
    const set = hook.result.current.set as (key: unknown, value: unknown) => void;

    act(() => {
      set("", 1);
      set("k".repeat(TOOL_LIMITS.maxKeyLength + 1), 1);
      set(42, 1);
      set("big", "x".repeat(TOOL_LIMITS.maxValueBytes));
      set("fn", () => 1);
      set("undef", undefined);
      set("nan", Number.NaN);
      set("date", new Date());
      set("map", new Map());
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      set("cyclic", cyclic);
      set("nested", { a: [undefined] });
    });
    expect(hook.result.current.data).toEqual({});
    expect(warn).toHaveBeenCalled();

    act(() => {
      set("k".repeat(TOOL_LIMITS.maxKeyLength), "ok");
      set("fits", "x".repeat(TOOL_LIMITS.maxValueBytes - 2));
    });
    expect(Object.keys(hook.result.current.data)).toHaveLength(2);
  });

  it("refuses new keys beyond the key limit but still updates existing ones", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Y.Doc();
    const full: Record<string, JsonValue> = {};
    for (let i = 0; i < TOOL_LIMITS.maxKeys; i++) full[`k${i}`] = i;
    addTool(doc, {}, full);
    const hook = renderHook(() => useToolState(doc, "t1"));
    act(() => hook.result.current.set("one-more", 1));
    expect(hook.result.current.data["one-more"]).toBeUndefined();
    act(() => hook.result.current.set("k0", "changed"));
    expect(hook.result.current.data.k0).toBe("changed");
    act(() => hook.result.current.del("k1"));
    act(() => hook.result.current.set("one-more", 1));
    expect(hook.result.current.data["one-more"]).toBe(1);
  });

  it("follows a tool that appears later and a state map that is replaced", () => {
    const [a, b] = syncedDocs();
    const hook = renderHook(() => useToolState(b, "t1"));
    expect(hook.result.current.data).toEqual({});
    act(() => hook.result.current.set("early", 1)); // no tool yet: dropped
    expect(hook.result.current.data).toEqual({});

    act(() => addTool(a, {}, { x: 1 }));
    expect(hook.result.current.data).toEqual({ x: 1 });

    act(() => {
      a.transact(() => {
        const next = new Y.Map<JsonValue>();
        toolsMap(a).get("t1")?.set("state", next);
        next.set("y", 2);
      });
    });
    expect(hook.result.current.data).toEqual({ y: 2 });
    act(() => {
      (toolsMap(a).get("t1")?.get("state") as Y.Map<JsonValue>).set("z", 3);
    });
    expect(hook.result.current.data).toEqual({ y: 2, z: 3 });

    act(() => {
      toolsMap(a).delete("t1");
    });
    expect(hook.result.current.data).toEqual({});
  });

  it("creates the state map when a tool has none", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const tool = new Y.Map<unknown>();
      toolsMap(doc).set("t1", tool);
      tool.set("id", "t1");
    });
    const hook = renderHook(() => useToolState(doc, "t1"));
    act(() => hook.result.current.set("a", 1));
    expect(hook.result.current.data).toEqual({ a: 1 });
  });
});

describe("useToolRecord", () => {
  it("is null without a tool and re-renders when a field changes, not when state does", () => {
    const [a, b] = syncedDocs();
    const hook = renderHook(() => useToolRecord(b, "t1"));
    expect(hook.result.current).toBeNull();
    act(() => addTool(a, { title: "One" }));
    expect(hook.result.current?.title).toBe("One");

    const before = hook.result.current;
    act(() => {
      (toolsMap(a).get("t1")?.get("state") as Y.Map<JsonValue>).set("k", 1);
    });
    expect(hook.result.current).toBe(before);

    act(() => {
      a.transact(() => patchTool(a, "t1", { title: "Two", version: 2 }));
    });
    expect(hook.result.current).toMatchObject({ title: "Two", version: 2 });
    expect(hook.result.current).not.toBe(before);
  });
});
