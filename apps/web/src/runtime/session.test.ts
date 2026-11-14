import type { JsonValue } from "@sofa/shared";
import { toolsMap } from "@sofa/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import sdkSource from "./sdk.js?raw";
import {
  type ChannelLike,
  FrameSession,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  type PortLike,
} from "./session";
import { NONCE_PLACEHOLDER } from "./srcdoc";
import { ToolStore } from "./store";
import { addTool, syncedDocs } from "./testing";

/** A channel that delivers synchronously and copies messages like structured clone does. */
function syncChannel(): ChannelLike {
  const make = (other: () => PortLike): PortLike => ({
    onmessage: null,
    postMessage(message) {
      other().onmessage?.({ data: structuredClone(message) });
    },
  });
  const port1: PortLike = make(() => port2);
  const port2: PortLike = make(() => port1);
  return { port1, port2 };
}

type Listener = (event: Record<string, unknown>) => void;

/**
 * Host session wired to the real SDK source running in a fake frame window. This is the
 * closest jsdom gets to a live frame: both ends are the production code, only the
 * transport is simulated.
 */
function setup(
  options: { nonce?: string; sdkNonce?: string; state?: Record<string, JsonValue> } = {},
) {
  const [doc, remote] = syncedDocs();
  addTool(doc, {}, options.state ?? { title: "Dinner" });
  const store = new ToolStore(doc, "t1");
  const context = {
    me: { id: "u1", name: "Ada", color: "#111", secret: "host-only" },
    members: [{ id: "u1", name: "Ada", color: "#111" }],
    theme: "light" as "light" | "dark",
  };
  const events = { ready: vi.fn(), height: vi.fn(), error: vi.fn(), lost: vi.fn() };
  const toFrame: unknown[] = [];
  const hostWindow = {
    postMessage: (data: unknown) => session.handleWindowMessage({ source: frameWindow, data }),
  };
  let listeners: Record<string, Listener[]> = {};
  const frameWindow = {
    postMessage(data: unknown, _origin: string, transfer?: unknown[]) {
      toFrame.push(data);
      for (const fn of listeners.message ?? []) {
        fn({ source: hostWindow, data, ports: transfer, stopImmediatePropagation() {} });
      }
    },
  };
  const session = new FrameSession({
    store,
    nonce: options.nonce ?? "n0nce",
    frameWindow: () => frameWindow,
    context: () => context,
    onReady: events.ready,
    onHeight: events.height,
    onError: events.error,
    onLost: events.lost,
    createChannel: syncChannel,
  });

  /** Load a document into the frame window: the SDK, as buildSrcdoc would embed it. */
  const loadSdk = () => {
    listeners = {};
    const frameDoc = document.implementation.createHTMLDocument("tool");
    const win: Record<string, unknown> = {
      document: frameDoc,
      parent: hostWindow,
      addEventListener: (type: string, fn: Listener) => {
        (listeners[type] ??= []).push(fn);
      },
      console: { error() {}, warn() {} },
      crypto: globalThis.crypto,
      TextEncoder,
    };
    new Function("window", sdkSource.split(NONCE_PLACEHOLDER).join(options.sdkNonce ?? "n0nce"))(
      win,
    );
    return win.sofa as any;
  };

  const stateMap = (d: Y.Doc) => toolsMap(d).get("t1")?.get("state") as Y.Map<JsonValue>;
  return { doc, remote, store, context, events, session, frameWindow, toFrame, loadSdk, stateMap };
}

describe("FrameSession with the real SDK", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands over a port on ready, then sends init only after the right nonce", () => {
    const t = setup();
    const sofa = t.loadSdk();
    const ready = vi.fn();
    sofa.ready(ready);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(t.events.ready).toHaveBeenCalledTimes(1);
    expect(sofa.state.all()).toEqual({ title: "Dinner" });
    expect(sofa.me).toEqual({ id: "u1", name: "Ada", color: "#111" }); // no extra fields
    // the only thing ever posted to the window (target "*") is the empty port message
    expect(t.toFrame).toEqual([{ type: "sofa:port" }]);
    t.session.dispose();
  });

  it("sends nothing to a document that does not know the nonce", () => {
    const t = setup({ sdkNonce: "guess" });
    const sofa = t.loadSdk();
    const ready = vi.fn();
    sofa.ready(ready);
    expect(ready).not.toHaveBeenCalled();
    expect(t.events.ready).not.toHaveBeenCalled();
    expect(sofa.state.all()).toEqual({});
    sofa.state.set("x", 1); // goes out on the port, but the session is not established
    expect(t.store.peek("x")).toBeUndefined();
    t.session.dispose();
  });

  it("ignores ready from another window and a second ready from the same frame", () => {
    const t = setup();
    t.session.handleWindowMessage({ source: {}, data: { type: "sofa:ready" } });
    expect(t.toFrame).toEqual([]);
    t.loadSdk();
    expect(t.toFrame).toHaveLength(1);
    // the frame navigated: a new document in the same window asks again and gets nothing
    const second = t.loadSdk();
    expect(t.toFrame).toHaveLength(1);
    expect(second.state.all()).toEqual({});
    t.session.dispose();
  });

  it("writes from the frame reach other members; remote changes reach the frame per key", () => {
    const t = setup();
    const sofa = t.loadSdk();
    const keys: unknown[] = [];
    sofa.state.subscribe((key: unknown) => keys.push(key));

    sofa.state.set("vote:u1", 2);
    expect(t.stateMap(t.remote).get("vote:u1")).toBe(2);
    expect(keys).toEqual(["vote:u1"]); // the host's answer did not notify a second time

    t.stateMap(t.remote).set("vote:u2", 1);
    t.stateMap(t.remote).delete("title");
    expect(keys).toEqual(["vote:u1", "vote:u2", "title"]);
    expect(sofa.state.all()).toEqual({ "vote:u1": 2, "vote:u2": 1 });

    sofa.state.delete("vote:u1");
    expect(t.stateMap(t.remote).has("vote:u1")).toBe(false);
    t.session.dispose();
  });

  it("answers a rejected write with the authoritative value so the frame converges", () => {
    const state: Record<string, JsonValue> = {};
    for (let i = 0; i < 5000; i++) state[`k${i}`] = i;
    const t = setup({ state });
    const sofa = t.loadSdk();
    sofa.state.set("one-too-many", 1);
    expect(sofa.state.get("one-too-many")).toBeUndefined();
    expect(t.store.peek("one-too-many")).toBeUndefined();
    expect(t.events.error).toHaveBeenCalledWith(expect.stringContaining("too many keys"));
    t.session.dispose();
  });

  it("validates raw port messages even when the SDK is bypassed", () => {
    const t = setup();
    let port: PortLike | undefined;
    // a hand-written frame document instead of the SDK
    const frameWindow = t.frameWindow as { postMessage: unknown };
    frameWindow.postMessage = (_data: unknown, _origin: string, transfer?: unknown[]) => {
      port = transfer?.[0] as PortLike;
    };
    t.session.handleWindowMessage({ source: t.frameWindow, data: { type: "sofa:ready" } });
    const answers: unknown[] = [];
    if (!port) throw new Error("no port");
    port.onmessage = (event) => answers.push(event.data);

    port.postMessage({ type: "sofa:set", key: "a", value: 1 }); // before hello: ignored
    expect(t.store.peek("a")).toBeUndefined();
    port.postMessage({ type: "sofa:hello", nonce: "n0nce" });
    expect(answers.map((m) => (m as { type: string }).type)).toEqual(["sofa:init"]);

    port.postMessage({ type: "sofa:set", key: "a", value: new Map() });
    port.postMessage({ type: "sofa:set", key: "b", value: "x".repeat(70_000) });
    port.postMessage({ type: "sofa:set", key: "c", value: 1, toolId: "other" });
    port.postMessage({ type: "sofa:set", key: 5, value: 1 });
    port.postMessage({ type: "sofa:state-all", state: {} });
    expect(t.store.getState()).toEqual({ title: "Dinner" });
    // the two well formed but invalid writes were answered, the malformed ones were not
    expect(answers.slice(1)).toEqual([
      { type: "sofa:state", key: "a", value: undefined },
      { type: "sofa:state", key: "b", value: undefined },
    ]);

    port.postMessage({ type: "sofa:resize", height: 99999 });
    expect(t.events.height).toHaveBeenLastCalledWith(4000);
    port.postMessage({ type: "sofa:error", message: "x".repeat(9000) });
    expect((t.events.error.mock.lastCall?.[0] as string).length).toBeLessThanOrEqual(500);
    t.session.dispose();
  });

  it("limits how fast a frame can write", () => {
    const t = setup();
    const sofa = t.loadSdk();
    for (let i = 0; i < 400; i++) sofa.state.set("n", i);
    const stored = t.store.peek("n") as number;
    expect(stored).toBeLessThan(399);
    expect(sofa.state.get("n")).toBe(stored); // the frame was told what was kept
    t.session.dispose();
  });

  it("forwards members and theme, and a replaced state map as a bulk change", () => {
    const t = setup();
    const sofa = t.loadSdk();
    const onMembers = vi.fn();
    sofa.onMembers(onMembers);
    t.context.members = [...t.context.members, { id: "u2", name: "Bo", color: "#222" }];
    t.session.pushMembers();
    expect(onMembers.mock.lastCall?.[0]).toHaveLength(2);
    t.context.theme = "dark";
    t.session.pushTheme();
    expect(sofa.theme).toBe("dark");

    const keys: unknown[] = [];
    sofa.state.subscribe((key: unknown) => keys.push(key));
    t.remote.transact(() => toolsMap(t.remote).delete("t1"));
    expect(keys).toEqual([undefined]);
    expect(sofa.state.all()).toEqual({});
    t.session.dispose();
  });

  it("reports a second load as a navigation and stops talking", () => {
    const t = setup();
    const sofa = t.loadSdk();
    t.session.handleLoad();
    expect(t.events.lost).not.toHaveBeenCalled();
    t.session.handleLoad();
    expect(t.events.lost).toHaveBeenCalledWith("navigated");
    t.stateMap(t.remote).set("later", 1);
    expect(sofa.state.get("later")).toBeUndefined();
    sofa.state.set("x", 1);
    expect(t.store.peek("x")).toBeUndefined();
  });

  it("notices a frame that stops answering pings", () => {
    vi.useFakeTimers();
    const t = setup();
    t.loadSdk();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 6);
    expect(t.events.lost).not.toHaveBeenCalled(); // the SDK answers

    // the document is gone (navigated away without a load event): pings fall on deaf ears
    const port = (t.session as unknown as { port: PortLike }).port;
    port.postMessage = () => {};
    vi.advanceTimersByTime(PING_TIMEOUT_MS + PING_INTERVAL_MS * 2);
    expect(t.events.lost).toHaveBeenCalledWith("unresponsive");
  });
});
