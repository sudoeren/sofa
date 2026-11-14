import { type Material, materialsArray, metaMap, putTool, type ToolRecord, toolStateMap, toolsMap } from "@sofra/shared";
import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { moveTool, moveToolTo, renameTool } from "./tools";
import { useMaterials, useSpaceTitle, useTools, useYMapKeys } from "./yhooks";

function tool(id: string, order: number): ToolRecord {
  return {
    id,
    title: `Tool ${id}`,
    description: "",
    kind: "widget",
    widgetType: "poll",
    config: {},
    html: "",
    status: "ready",
    version: 1,
    order,
    span: 1,
    createdBy: "u1",
    createdAt: order,
    updatedAt: order,
  };
}

function material(id: string): Material {
  return { id, kind: "note", text: id, authorId: "u1", authorName: "Deniz", createdAt: 1 };
}

describe("Y hooks", () => {
  it("useMaterials re-renders on local and remote changes", () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    function List() {
      const items = useMaterials(doc);
      return <p data-testid="list">{items.map((item) => item.id).join(",")}</p>;
    }
    render(<List />);
    expect(screen.getByTestId("list").textContent).toBe("");

    act(() => materialsArray(doc).push([material("a")]));
    expect(screen.getByTestId("list").textContent).toBe("a");

    materialsArray(remote).push([material("b")]);
    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote)));
    expect(screen.getByTestId("list").textContent?.split(",").sort()).toEqual(["a", "b"]);
  });

  it("returns the same snapshot until something changes", () => {
    const doc = new Y.Doc();
    const { result, rerender } = renderHook(() => useMaterials(doc));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => materialsArray(doc).push([material("a")]));
    expect(result.current).not.toBe(first);
  });

  it("useSpaceTitle follows meta.title", () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() => useSpaceTitle(doc));
    expect(result.current).toBe("");
    act(() => metaMap(doc).set("title", "Lisbon"));
    expect(result.current).toBe("Lisbon");
  });

  it("useYMapKeys lists the keys of a map", () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() => useYMapKeys(toolsMap(doc) as Y.Map<unknown>));
    expect(result.current).toEqual([]);
    act(() => doc.transact(() => putTool(doc, tool("a", 1))));
    expect(result.current).toEqual(["a"]);
    act(() => toolsMap(doc).delete("a"));
    expect(result.current).toEqual([]);
  });

  it("useTools is sorted, follows record changes and ignores tool state changes", () => {
    const doc = new Y.Doc();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTools(doc);
    });
    act(() =>
      doc.transact(() => {
        putTool(doc, tool("b", 2));
        putTool(doc, tool("a", 1));
        putTool(doc, tool("c", 3));
      }),
    );
    expect(result.current.map((item) => item.id)).toEqual(["a", "b", "c"]);

    act(() => renameTool(doc, "b", "Dinner"));
    expect(result.current[1]?.title).toBe("Dinner");

    const before = renders;
    const snapshot = result.current;
    act(() => {
      const record = toolsMap(doc).get("a");
      if (record) toolStateMap(record).set("vote:u1", "x");
    });
    expect(renders).toBe(before);
    expect(result.current).toBe(snapshot);

    act(() => moveTool(doc, "c", -1));
    expect(result.current.map((item) => item.id)).toEqual(["a", "c", "b"]);
    act(() => moveToolTo(doc, "b", "a"));
    expect(result.current.map((item) => item.id)).toEqual(["b", "a", "c"]);
    act(() => moveTool(doc, "b", -1));
    expect(result.current.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});
