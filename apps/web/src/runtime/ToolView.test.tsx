import { type JsonValue, patchTool } from "@sofra/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { z } from "zod";
import type { WidgetProps } from "../widgets/types";
import { addTool } from "./testing";

// The real registry and catalog are written by others and may not exist yet; these tests
// never load them.
vi.mock("../widgets", () => ({ WIDGETS: {} }));
vi.mock("@sofra/widgets", () => ({ getWidgetDef: () => undefined }));

import { FRAME_CSP } from "./srcdoc";
import { ToolView, type WidgetDefLookup, type WidgetRegistry } from "./ToolView";

type CounterConfig = { label: string };

function Counter({ config, data, set, del, me, members }: WidgetProps<CounterConfig>) {
  const count = typeof data.count === "number" ? data.count : 0;
  return (
    <div>
      <span data-testid="label">{config.label}</span>
      <span data-testid="count">{count}</span>
      <span data-testid="who">{`${me.name}/${members.length}`}</span>
      <button type="button" onClick={() => set("count", count + 1)}>
        add
      </button>
      <button type="button" onClick={() => del("count")}>
        clear
      </button>
    </div>
  );
}

function Crasher({ data }: WidgetProps<unknown>) {
  if (data.explode) throw new Error("widget exploded");
  return <div>calm</div>;
}

const widgets: WidgetRegistry = { counter: Counter, crasher: Crasher };
const defs: Record<string, { configSchema: z.ZodType }> = {
  counter: { configSchema: z.object({ label: z.string().default("Count") }) },
  crasher: { configSchema: z.any() },
  orphan: { configSchema: z.any() },
};
const getDef: WidgetDefLookup = (type) => (Object.hasOwn(defs, type) ? defs[type] : undefined);

const me = { id: "u1", name: "Ada", color: "#111" };
const members = [me, { id: "u2", name: "Bo", color: "#222" }];

function view(doc: Y.Doc) {
  return render(
    <ToolView
      doc={doc}
      toolId="t1"
      me={me}
      members={members}
      theme="light"
      widgets={widgets}
      getDef={getDef}
    />,
  );
}

afterEach(cleanup);

describe("ToolView", () => {
  it("renders a widget with parsed config and live state", () => {
    const doc = new Y.Doc();
    addTool(doc, { kind: "widget", widgetType: "counter", config: {} }, { count: 2 });
    view(doc);
    expect(screen.getByTestId("label").textContent).toBe("Count"); // schema default applied
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("who").textContent).toBe("Ada/2");
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("count").textContent).toBe("3");
    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      doc.transact(() => patchTool(doc, "t1", { config: { label: "Guests" } }));
    });
    expect(screen.getByTestId("label").textContent).toBe("Guests");
  });

  it("shows a message for an invalid config", () => {
    const doc = new Y.Doc();
    addTool(doc, { kind: "widget", widgetType: "counter", config: { label: 5 } as JsonValue });
    view(doc);
    expect(screen.getByText(/settings of this tool are not valid/i)).toBeTruthy();
    expect(screen.queryByTestId("label")).toBeNull();
  });

  it("shows a message for an unknown type, a type without a component, and prototype names", () => {
    for (const widgetType of ["nope", "orphan", "constructor", "__proto__"]) {
      const doc = new Y.Doc();
      addTool(doc, { kind: "widget", widgetType, config: {} });
      view(doc);
      expect(screen.getByText(/not available here/i)).toBeTruthy();
      cleanup();
    }
  });

  it("contains a crashing widget and recovers on request", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new Y.Doc();
    addTool(doc, { kind: "widget", widgetType: "crasher", config: {} }, { explode: true });
    render(
      <div>
        <span>shell</span>
        <ToolView
          doc={doc}
          toolId="t1"
          me={me}
          members={members}
          theme="light"
          widgets={widgets}
          getDef={getDef}
        />
      </div>,
    );
    expect(screen.getByText("shell")).toBeTruthy();
    expect(screen.getByText(/ran into a problem/i)).toBeTruthy();
    expect(screen.getByText("widget exploded")).toBeTruthy();
    expect(error).toHaveBeenCalled();

    act(() => {
      (doc.getMap("tools").get("t1") as Y.Map<unknown>).get("state") as Y.Map<JsonValue>;
      ((doc.getMap("tools").get("t1") as Y.Map<unknown>).get("state") as Y.Map<JsonValue>).delete(
        "explode",
      );
    });
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByText("calm")).toBeTruthy();
  });

  it("shows a working state while generating and the error text on failure", () => {
    const doc = new Y.Doc();
    addTool(doc, { status: "generating" });
    view(doc);
    expect(screen.getByLabelText("Building this tool")).toBeTruthy();

    act(() => {
      doc.transact(() => patchTool(doc, "t1", { status: "error", error: "The model gave up." }));
    });
    expect(screen.getByRole("alert").textContent).toContain("The model gave up.");
  });

  it("keeps the previous content visible under an error", () => {
    const doc = new Y.Doc();
    addTool(doc, {
      kind: "widget",
      widgetType: "counter",
      config: {},
      status: "error",
      error: "Change failed",
    });
    view(doc);
    expect(screen.getByRole("alert").textContent).toContain("Change failed");
    expect(screen.getByTestId("label")).toBeTruthy();
  });

  it("says so when the tool is gone", () => {
    view(new Y.Doc());
    expect(screen.getByText(/no longer exists/i)).toBeTruthy();
  });

  it("renders html tools in a locked-down frame and reloads only on a new version", () => {
    const doc = new Y.Doc();
    addTool(doc, { kind: "html", html: "<p>hello</p>", version: 1 });
    const { container } = view(doc);
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.hasAttribute("src")).toBe(false);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain(FRAME_CSP);
    expect(srcdoc).toContain("<p>hello</p>");
    expect(srcdoc).not.toContain("__SOFRA_NONCE__");

    // state and metadata changes leave the element alone
    act(() => {
      doc.transact(() => patchTool(doc, "t1", { title: "Renamed", order: 5 }));
    });
    expect(container.querySelector("iframe")).toBe(frame);

    act(() => {
      doc.transact(() => patchTool(doc, "t1", { html: "<p>second</p>", version: 2 }));
    });
    const next = container.querySelector("iframe") as HTMLIFrameElement;
    expect(next).not.toBe(frame);
    expect(next.getAttribute("srcdoc")).toContain("<p>second</p>");
    expect(next.getAttribute("srcdoc")).not.toBe(srcdoc);
  });

  it("resets a frame that navigates and stops it when it does so again", () => {
    const doc = new Y.Doc();
    addTool(doc, { kind: "html", html: "<p>hello</p>" });
    const { container } = view(doc);
    const first = container.querySelector("iframe") as HTMLIFrameElement;
    fireEvent.load(first); // the srcdoc itself
    expect(container.querySelector("iframe")).toBe(first);
    fireEvent.load(first); // something else loaded in the frame
    const second = container.querySelector("iframe") as HTMLIFrameElement;
    expect(second).not.toBe(first);
    expect(screen.getByText(/tried to open another page/i)).toBeTruthy();

    fireEvent.load(second);
    fireEvent.load(second);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/was stopped/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Run it again"));
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("reports a frame that never becomes ready", () => {
    vi.useFakeTimers();
    try {
      const doc = new Y.Doc();
      addTool(doc, { kind: "html", html: "<p>hello</p>" });
      view(doc);
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(screen.getByText("This tool did not start.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
