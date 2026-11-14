import { beforeEach, describe, expect, it, vi } from "vitest";
import sdkSource from "./sdk.js?raw";

type Listener = (event: Record<string, unknown>) => void;

/** Evaluate the SDK against a fake window with a mocked parent, as the frame would. */
function boot(options: { theme?: string; extras?: Record<string, unknown> } = {}) {
  const doc = document.implementation.createHTMLDocument("tool");
  doc.documentElement.setAttribute("data-theme", options.theme ?? "light");
  const listeners: Record<string, Listener[]> = {};
  const parent = { postMessage: vi.fn() };
  const win: Record<string, unknown> = {
    document: doc,
    parent,
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    console: { error: vi.fn(), warn: vi.fn() },
    crypto: globalThis.crypto,
    TextEncoder,
    ...options.extras,
  };
  new Function("window", sdkSource)(win);

  const port = {
    postMessage: vi.fn(),
    onmessage: null as null | ((event: { data: unknown }) => void),
  };
  const fire = (type: string, event: Record<string, unknown>) => {
    for (const fn of listeners[type] ?? []) fn(event);
  };
  const connect = (source: unknown = parent) =>
    fire("message", {
      source,
      data: { type: "sofra:port" },
      ports: [port],
      stopImmediatePropagation: vi.fn(),
    });
  const fromHost = (data: unknown) => port.onmessage?.({ data });
  const sent = (type: string) =>
    port.postMessage.mock.calls.map((call) => call[0]).filter((m) => m.type === type);
  const init = (state: Record<string, unknown> = {}) =>
    fromHost({
      type: "sofra:init",
      toolId: "t1",
      state,
      me: { id: "u1", name: "Ada", color: "#111" },
      members: [{ id: "u1", name: "Ada", color: "#111" }],
      theme: "dark",
    });
  const sofra = win.sofra as any;
  return { win, doc, parent, port, fire, connect, fromHost, sent, init, sofra };
}

describe("frame SDK", () => {
  let frame: ReturnType<typeof boot>;
  beforeEach(() => {
    frame = boot();
  });

  it("announces itself to the parent and waits for a port", () => {
    expect(frame.parent.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.parent.postMessage).toHaveBeenCalledWith({ type: "sofra:ready" }, "*");
    frame.connect();
    expect(frame.port.postMessage.mock.calls[0]?.[0]).toEqual({
      type: "sofra:hello",
      nonce: "__SOFRA_NONCE__",
    });
  });

  it("takes a port only from its parent window", () => {
    frame.connect({ not: "the parent" });
    expect(frame.port.onmessage).toBeNull();
    expect(frame.port.postMessage).not.toHaveBeenCalled();
    frame.connect();
    expect(frame.port.onmessage).not.toBeNull();
  });

  it("init fills state, me, members and theme and reflects the theme on <html>", () => {
    expect(frame.sofra.theme).toBe("light");
    frame.connect();
    frame.init({ title: "Dinner", "vote:u1": 2 });
    expect(frame.sofra.state.get("title")).toBe("Dinner");
    expect(frame.sofra.me).toEqual({ id: "u1", name: "Ada", color: "#111" });
    expect(frame.sofra.members).toHaveLength(1);
    expect(frame.sofra.theme).toBe("dark");
    expect(frame.doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(frame.sofra.state.keys().sort()).toEqual(["title", "vote:u1"]);
    expect(frame.sofra.state.keys("vote:")).toEqual(["vote:u1"]);
    expect(frame.sofra.state.entries("vote:")).toEqual([["vote:u1", 2]]);
    expect(frame.sofra.state.all()).toEqual({ title: "Dinner", "vote:u1": 2 });
    expect(frame.sofra.state.get("missing")).toBeUndefined();
  });

  it("runs ready callbacks once, whether registered before or after init", () => {
    const early = vi.fn();
    frame.sofra.ready(early);
    expect(early).not.toHaveBeenCalled();
    frame.connect();
    frame.init({ a: 1 });
    expect(early).toHaveBeenCalledTimes(1);
    const late = vi.fn(() => expect(frame.sofra.state.get("a")).toBe(1));
    frame.sofra.ready(late);
    expect(late).toHaveBeenCalledTimes(1);
    frame.init({ a: 2 }); // a second init is ignored
    expect(early).toHaveBeenCalledTimes(1);
    expect(frame.sofra.state.get("a")).toBe(1);
  });

  it("applies local writes at once, notifies subscribers and tells the host", () => {
    frame.connect();
    frame.init();
    const seen: unknown[] = [];
    const unsubscribe = frame.sofra.state.subscribe((key: string) => {
      seen.push([key, frame.sofra.state.get(key)]);
    });
    frame.sofra.state.set("item:1", { text: "milk" });
    expect(frame.sofra.state.get("item:1")).toEqual({ text: "milk" });
    expect(seen).toEqual([["item:1", { text: "milk" }]]);
    expect(frame.sent("sofra:set")).toEqual([
      { type: "sofra:set", key: "item:1", value: { text: "milk" } },
    ]);

    frame.sofra.state.set("item:1", { text: "milk" }); // unchanged: nothing happens
    expect(seen).toHaveLength(1);
    expect(frame.sent("sofra:set")).toHaveLength(1);

    frame.sofra.state.delete("item:1");
    expect(frame.sofra.state.get("item:1")).toBeUndefined();
    expect(frame.sent("sofra:delete")).toEqual([{ type: "sofra:delete", key: "item:1" }]);
    expect(seen).toHaveLength(2);

    unsubscribe();
    frame.sofra.state.set("x", 1);
    expect(seen).toHaveLength(2);
  });

  it("applies remote changes and notifies with the key; bulk changes notify without one", () => {
    frame.connect();
    frame.init({ a: 1 });
    const keys: unknown[] = [];
    frame.sofra.state.subscribe((key: unknown) => keys.push(key));
    frame.fromHost({ type: "sofra:state", key: "b", value: [1] });
    frame.fromHost({ type: "sofra:state", key: "a", value: undefined });
    frame.fromHost({ type: "sofra:state", key: "b", value: [1] }); // same value: silent
    expect(keys).toEqual(["b", "a"]);
    expect(frame.sofra.state.all()).toEqual({ b: [1] });
    frame.fromHost({ type: "sofra:state-all", state: { z: 9 } });
    expect(keys).toEqual(["b", "a", undefined]);
    expect(frame.sofra.state.all()).toEqual({ z: 9 });
  });

  it("converges on the host's answer and does not flicker while typing", () => {
    frame.connect();
    frame.init();
    const renders: unknown[] = [];
    frame.sofra.state.subscribe(() => renders.push(frame.sofra.state.get("t")));
    frame.sofra.state.set("t", "a");
    frame.sofra.state.set("t", "ab");
    frame.sofra.state.set("t", "abc");
    // answers to the older writes arrive late and must not roll the text back
    frame.fromHost({ type: "sofra:state", key: "t", value: "a" });
    frame.fromHost({ type: "sofra:state", key: "t", value: "ab" });
    frame.fromHost({ type: "sofra:state", key: "t", value: "abc" });
    expect(renders).toEqual(["a", "ab", "abc"]);

    // a rejected write is answered with the authoritative value
    frame.sofra.state.set("t", "abcd");
    frame.fromHost({ type: "sofra:state", key: "t", value: "abc" });
    expect(frame.sofra.state.get("t")).toBe("abc");

    // a remote value in flight, then the answer to the local write: the answer wins
    frame.sofra.state.set("t", "mine");
    frame.fromHost({ type: "sofra:state", key: "t", value: "theirs" });
    frame.fromHost({ type: "sofra:state", key: "t", value: "mine" });
    expect(frame.sofra.state.get("t")).toBe("mine");
  });

  it("clones values in and out", () => {
    frame.connect();
    frame.init({ list: [1, 2] });
    const out = frame.sofra.state.get("list");
    out.push(3);
    expect(frame.sofra.state.get("list")).toEqual([1, 2]);
    frame.sofra.state.all().list.push(4);
    frame.sofra.state.entries()[0][1].push(5);
    expect(frame.sofra.state.get("list")).toEqual([1, 2]);

    const value = { n: 1 };
    frame.sofra.state.set("obj", value);
    value.n = 2;
    expect(frame.sofra.state.get("obj")).toEqual({ n: 1 });
    expect(frame.sent("sofra:set")[0].value).toEqual({ n: 1 });

    frame.sofra.me.name = "Mallory";
    frame.sofra.members.push({ id: "x" });
    expect(frame.sofra.me.name).toBe("Ada");
    expect(frame.sofra.members).toHaveLength(1);
  });

  it("refuses invalid writes locally and reports them", () => {
    frame.connect();
    frame.init();
    frame.sofra.state.set("", 1);
    frame.sofra.state.set("k".repeat(201), 1);
    frame.sofra.state.set("fn", () => 1);
    frame.sofra.state.set("undef", undefined);
    frame.sofra.state.set("big", "x".repeat(70_000));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    frame.sofra.state.set("cyclic", cyclic);
    expect(frame.sofra.state.keys()).toEqual([]);
    expect(frame.sent("sofra:set")).toEqual([]);
    expect(frame.sent("sofra:error").length).toBeGreaterThan(0);
  });

  it("queues what happens before the port arrives", () => {
    frame.sofra.state.set("early", 1);
    expect(frame.sofra.state.get("early")).toBe(1);
    frame.connect();
    const types = frame.port.postMessage.mock.calls.map((call) => call[0].type);
    expect(types).toEqual(["sofra:hello", "sofra:set"]);
  });

  it("forwards members and theme changes", () => {
    frame.connect();
    frame.init();
    const onMembers = vi.fn();
    const onTheme = vi.fn();
    frame.sofra.onMembers(onMembers);
    frame.sofra.onTheme(onTheme);
    frame.fromHost({ type: "sofra:members", members: [{ id: "u2", name: "Bo", color: "#222" }] });
    frame.fromHost({ type: "sofra:theme", theme: "light" });
    expect(onMembers).toHaveBeenCalledWith([{ id: "u2", name: "Bo", color: "#222" }]);
    expect(onTheme).toHaveBeenCalledWith("light");
    expect(frame.sofra.theme).toBe("light");
    expect(frame.doc.documentElement.getAttribute("data-theme")).toBe("light");
    frame.fromHost({ type: "sofra:theme", theme: "<script>" });
    expect(frame.doc.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("forwards uncaught errors, rejections and errors thrown by callbacks", () => {
    frame.connect();
    frame.init();
    frame.fire("error", { message: "x is not defined", lineno: 12 });
    frame.fire("unhandledrejection", { reason: new Error("nope") });
    frame.sofra.state.subscribe(() => {
      throw new Error("render failed");
    });
    const other = vi.fn();
    frame.sofra.state.subscribe(other);
    frame.sofra.state.set("a", 1);
    expect(other).toHaveBeenCalled(); // one bad subscriber does not stop the others
    frame.sofra.ready(() => {
      throw new Error("ready failed");
    });
    expect(frame.sent("sofra:error").map((m) => m.message)).toEqual([
      "x is not defined (line 12)",
      "nope",
      "render failed",
      "ready failed",
    ]);
  });

  it("stops a subscriber that keeps writing instead of looping forever", () => {
    frame.connect();
    frame.init();
    let n = 0;
    frame.sofra.state.subscribe(() => frame.sofra.state.set("n", ++n));
    frame.sofra.state.set("go", 1);
    expect(n).toBeLessThan(50);
    expect(frame.sent("sofra:error").some((m) => /loop/.test(m.message))).toBe(true);
  });

  it("answers pings", () => {
    frame.connect();
    frame.init();
    frame.fromHost({ type: "sofra:ping" });
    expect(frame.sent("sofra:pong")).toHaveLength(1);
  });

  it("makes ids", () => {
    const a = frame.sofra.id();
    expect(a).toMatch(/^[0-9a-z]{12}$/);
    expect(frame.sofra.id()).not.toBe(a);
  });

  it("turns dialogs into no-ops", () => {
    const w = frame.win as Record<string, (...args: unknown[]) => unknown>;
    expect(w.alert?.("x")).toBeUndefined();
    expect(w.confirm?.("x")).toBe(false);
    expect(w.prompt?.("x")).toBeNull();
    expect(w.open?.("https://example.com")).toBeNull();
  });

  it("prevents form submits and link navigations but leaves fragment links alone", () => {
    const { doc } = frame;
    doc.body.innerHTML =
      '<form id="f"><button>go</button></form><a id="out" href="https://example.com"><b id="in">x</b></a>' +
      '<a id="frag" href="#top">top</a><a id="none">plain</a>';
    const dispatch = (id: string, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      doc.getElementById(id)?.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(dispatch("f", "submit")).toBe(true);
    expect(dispatch("in", "click")).toBe(true);
    expect(dispatch("out", "click")).toBe(true);
    expect(dispatch("frag", "click")).toBe(false);
    expect(dispatch("none", "click")).toBe(false);
  });

  it("gives tools an in-memory stand-in when storage throws, as it does in a sandbox", () => {
    const extras: Record<string, unknown> = {};
    Object.defineProperty(extras, "localStorage", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    const win: Record<string, unknown> = {};
    Object.defineProperties(win, Object.getOwnPropertyDescriptors(extras));
    // boot() spreads extras, which would call the getter; build this window by hand
    const doc = document.implementation.createHTMLDocument("tool");
    Object.assign(win, {
      document: doc,
      parent: { postMessage: vi.fn() },
      addEventListener: vi.fn(),
    });
    new Function("window", sdkSource)(win);
    const storage = win.localStorage as Storage;
    storage.setItem("a", "1");
    expect(storage.getItem("a")).toBe("1");
    expect(storage.length).toBe(1);
    storage.clear();
    expect(storage.getItem("a")).toBeNull();
  });

  it("reports its content height and asks for scrolling only beyond the limit", () => {
    let height = 300;
    const sized = boot({ extras: { setTimeout: (fn: () => void) => fn() } });
    sized.doc.documentElement.getBoundingClientRect = () => ({ height }) as DOMRect;
    sized.connect();
    sized.init();
    expect(sized.sent("sofra:resize").at(-1)).toEqual({ type: "sofra:resize", height: 300 });
    const count = sized.sent("sofra:resize").length;
    sized.sofra.state.set("a", 1); // same height: no new message
    expect(sized.sent("sofra:resize")).toHaveLength(count);
    height = 5000.4;
    sized.sofra.state.set("a", 2);
    expect(sized.sent("sofra:resize").at(-1)).toEqual({ type: "sofra:resize", height: 5001 });
    expect(sized.doc.documentElement.hasAttribute("data-sofra-scroll")).toBe(true);
    height = 200;
    sized.sofra.state.set("a", 3);
    expect(sized.doc.documentElement.hasAttribute("data-sofra-scroll")).toBe(false);
  });
});
