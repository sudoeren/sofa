import { TOOL_LIMITS } from "@sofra/shared";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  checkFrameMessage,
  checkJsonValue,
  cleanErrorText,
  isReadyFromFrame,
  MAX_ERROR_LENGTH,
  publicMember,
  WriteBudget,
} from "./guard";
import { ToolStore } from "./store";
import { addTool } from "./testing";

describe("checkFrameMessage", () => {
  it("accepts well formed messages", () => {
    expect(checkFrameMessage({ type: "sofra:ready" })).toEqual({
      kind: "accept",
      message: { type: "sofra:ready" },
    });
    expect(
      checkFrameMessage({ type: "sofra:set", key: "a", value: { n: [1, "x", null] } }),
    ).toEqual({
      kind: "accept",
      message: { type: "sofra:set", key: "a", value: { n: [1, "x", null] } },
    });
    expect(checkFrameMessage({ type: "sofra:delete", key: "a" }).kind).toBe("accept");
    expect(checkFrameMessage({ type: "sofra:error", message: "boom" }).kind).toBe("accept");
  });

  it("ignores wrong shapes", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "sofra:ready",
      42,
      [],
      [{ type: "sofra:ready" }],
      {},
      { type: 1 },
      { type: "sofra:init", state: {} },
      { type: "sofra:state", key: "a", value: 1 },
      { type: "other:set", key: "a", value: 1 },
      { type: "sofra:ready", extra: 1 },
      { type: "sofra:set", key: "a" },
      { type: "sofra:set", key: "a", value: 1, toolId: "t2" },
      { type: "sofra:set", key: 1, value: 1 },
      { type: "sofra:set", key: "", value: 1 },
      { type: "sofra:set", key: "k".repeat(TOOL_LIMITS.maxKeyLength + 1), value: 1 },
      { type: "sofra:delete", key: ["a"] },
      { type: "sofra:delete" },
      { type: "sofra:resize", height: "100" },
      { type: "sofra:resize", height: Number.NaN },
      { type: "sofra:resize", height: -1 },
      { type: "sofra:error", message: { toString: () => "x" } },
      { type: "sofra:hello", nonce: "" },
      { type: "sofra:hello", nonce: 1 },
      new Map([["type", "sofra:ready"]]),
      new (class Ready {
        type = "sofra:ready";
      })(),
    ];
    for (const data of bad)
      expect(checkFrameMessage(data), JSON.stringify(data)).toEqual({ kind: "ignore" });
  });

  it("rejects writes with values that are too large or not JSON, naming the key", () => {
    const big = checkFrameMessage({
      type: "sofra:set",
      key: "a",
      value: "x".repeat(TOOL_LIMITS.maxValueBytes + 1),
    });
    expect(big).toMatchObject({ kind: "reject", key: "a" });
    // multi-byte text is measured in bytes, not characters
    expect(checkFrameMessage({ type: "sofra:set", key: "a", value: "ç".repeat(40_000) }).kind).toBe(
      "reject",
    );
    for (const value of [
      undefined,
      () => 1,
      new Date(),
      new Map(),
      10n,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(checkFrameMessage({ type: "sofra:set", key: "a", value }).kind).toBe("reject");
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(checkFrameMessage({ type: "sofra:set", key: "a", value: cyclic }).kind).toBe("reject");
    expect(
      checkFrameMessage({ type: "sofra:set", key: "a", value: new Array(1_000_000) }).kind,
    ).toBe("reject");
  });

  it("never runs a toJSON hook from the frame and returns a private copy", () => {
    let called = false;
    const value = {
      inner: {
        toJSON() {
          called = true;
          return 1;
        },
      },
    };
    expect(checkFrameMessage({ type: "sofra:set", key: "a", value }).kind).toBe("reject");
    expect(called).toBe(false);

    const source = { list: [1] };
    const checked = checkJsonValue(source);
    expect(checked.ok && checked.value).toEqual(source);
    expect(checked.ok && checked.value).not.toBe(source);
  });

  it("clamps heights and cleans error text", () => {
    const tall = checkFrameMessage({ type: "sofra:resize", height: 1e9 });
    expect(tall).toEqual({
      kind: "accept",
      message: { type: "sofra:resize", height: TOOL_LIMITS.maxFrameHeight },
    });
    const short = checkFrameMessage({ type: "sofra:resize", height: 3.2 });
    expect(short.kind === "accept" && short.message).toMatchObject({
      height: TOOL_LIMITS.minFrameHeight,
    });
    expect(cleanErrorText("a\n\u0000b   c")).toBe("a b c");
    expect(cleanErrorText("x".repeat(5000)).length).toBe(MAX_ERROR_LENGTH);
  });
});

describe("isReadyFromFrame", () => {
  const frame = {};
  it("accepts only sofra:ready from the frame's own window", () => {
    expect(isReadyFromFrame({ source: frame, data: { type: "sofra:ready" } }, frame)).toBe(true);
    expect(isReadyFromFrame({ source: {}, data: { type: "sofra:ready" } }, frame)).toBe(false);
    expect(isReadyFromFrame({ source: null, data: { type: "sofra:ready" } }, frame)).toBe(false);
    expect(isReadyFromFrame({ source: null, data: { type: "sofra:ready" } }, null)).toBe(false);
    expect(isReadyFromFrame({ source: undefined, data: { type: "sofra:ready" } }, undefined)).toBe(
      false,
    );
    // data messages are not accepted on the window at all, even from the right source
    expect(
      isReadyFromFrame({ source: frame, data: { type: "sofra:set", key: "a", value: 1 } }, frame),
    ).toBe(false);
  });
});

describe("store writes (the path frames and widgets share)", () => {
  it("refuses a new key when the tool already has the maximum number of keys", () => {
    const doc = new Y.Doc();
    const full: Record<string, number> = {};
    for (let i = 0; i < TOOL_LIMITS.maxKeys; i++) full[`k${i}`] = i;
    addTool(doc, {}, full);
    const store = new ToolStore(doc, "t1");
    expect(store.write("extra", 1)).toEqual({ ok: false, reason: "too many keys" });
    expect(store.write("k5", "new")).toEqual({ ok: true });
    expect(store.peek("k5")).toBe("new");
    expect(store.peek("extra")).toBeUndefined();
  });

  it("refuses writes to a tool that does not exist", () => {
    const store = new ToolStore(new Y.Doc(), "missing");
    expect(store.write("a", 1).ok).toBe(false);
    expect(store.remove("a").ok).toBe(true);
  });
});

describe("helpers", () => {
  it("publicMember copies only id, name and color", () => {
    const member = { id: "u1", name: "Ada", color: "#fff", token: "secret" };
    expect(publicMember(member)).toEqual({ id: "u1", name: "Ada", color: "#fff" });
  });

  it("WriteBudget limits bursts and refills over time", () => {
    let now = 0;
    const budget = new WriteBudget(3, 1, () => now);
    expect([budget.take(), budget.take(), budget.take(), budget.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 2000;
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
  });
});
