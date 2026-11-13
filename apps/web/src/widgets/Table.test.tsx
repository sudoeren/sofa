import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import { getWidgetDef, type TableConfig, type WidgetDef } from "@sofra/widgets";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Table } from "./Table";

const me: MemberInfo = { id: "u1", name: "Ada Lovelace", color: "#aa3355" };
const bob: MemberInfo = { id: "u2", name: "Bob Stone", color: "#3355aa" };
const table = getWidgetDef("table") as WidgetDef<TableConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: TableConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Table
      config={config}
      data={data}
      me={me}
      members={[me, bob]}
      set={(key: string, value: JsonValue) => setData((d) => ({ ...d, [key]: value }))}
      del={(key: string) =>
        setData((d) => {
          const next = { ...d };
          delete next[key];
          return next;
        })
      }
    />
  );
}

const base = table.configSchema.parse({
  columns: [
    { id: "item", label: "Item" },
    { id: "qty", label: "Qty", type: "number" },
    { id: "who", label: "Who", type: "member" },
    { id: "kind", label: "Kind", type: "select", options: ["Food", "Drink"] },
    { id: "ok", label: "Packed", type: "checkbox" },
  ],
  rows: [
    { id: "r1", cells: { item: "Bread", qty: 2, kind: "Food" } },
    { id: "r2", cells: { item: "Juice", qty: 3.5, ok: true } },
  ],
  summary: "sum",
});
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const total = () => screen.getByLabelText("Total Qty").textContent;
afterEach(cleanup);

describe("Table", () => {
  it("renders config content and the sum footer", () => {
    render(<Harness config={base} />);
    expect(field("Item, row 1").value).toBe("Bread");
    expect(field("Qty, row 2").value).toBe("3.5");
    expect(field("Packed, row 2").checked).toBe(true);
    expect((screen.getByLabelText("Kind, row 1") as HTMLSelectElement).value).toBe("Food");
    expect(total()).toBe("5.5");
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("edits cells, one state key per cell", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.clear(field("Item, row 1"));
    await user.type(field("Item, row 1"), "Sourdough");
    await user.tab();
    expect(state["cell:r1:item"]).toBe("Sourdough");
    expect(document.activeElement).toBe(field("Qty, row 1"));

    await user.keyboard("4,5");
    await user.tab();
    expect(state["cell:r1:qty"]).toBe(4.5);
    expect(total()).toBe("8");

    await user.clear(field("Qty, row 2"));
    await user.type(field("Qty, row 2"), "lots");
    await user.tab();
    expect("cell:r2:qty" in state).toBe(false);
    expect(field("Qty, row 2").value).toBe("3.5");

    await user.click(field("Packed, row 1"));
    expect(state["cell:r1:ok"]).toBe(true);
    await user.selectOptions(screen.getByLabelText("Kind, row 2"), "Drink");
    expect(state["cell:r2:kind"]).toBe("Drink");
    await user.selectOptions(screen.getByLabelText("Who, row 1"), "u2");
    expect(state["cell:r1:who"]).toEqual({ id: "u2", name: "Bob Stone" });
    expect(Object.keys(state).sort()).toEqual([
      "cell:r1:item",
      "cell:r1:ok",
      "cell:r1:qty",
      "cell:r1:who",
      "cell:r2:kind",
    ]);
  });

  it("overrides a config value with null when a cell is emptied, and reverts on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.clear(field("Qty, row 1"));
    await user.tab();
    expect(state["cell:r1:qty"]).toBeNull();
    expect(field("Qty, row 1").value).toBe("");
    expect(total()).toBe("3.5");

    await user.clear(field("Item, row 2"));
    await user.type(field("Item, row 2"), "Nope{Escape}");
    expect("cell:r2:item" in state).toBe(false);
    expect(field("Item, row 2").value).toBe("Juice");
  });

  it("moves down with Enter and adds a row after the last one", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.click(field("Item, row 1"));
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(field("Item, row 2"));
    await user.keyboard("{Enter}");
    const rowKey = Object.keys(state).find((key) => key.startsWith("row:"));
    expect(rowKey).toBeTruthy();
    expect(document.activeElement).toBe(field("Item, row 3"));
    await user.keyboard("Cheese");
    await user.keyboard("{ArrowUp}");
    expect(state[`cell:${rowKey?.slice(4)}:item`]).toBe("Cheese");
    expect(document.activeElement).toBe(field("Item, row 2"));
    // Enter on an empty last row does not pile up more rows
    await user.click(screen.getByRole("button", { name: /Add row/ }));
    expect(document.activeElement).toBe(field("Item, row 4"));
    await user.keyboard("{Enter}");
    expect(Object.keys(state).filter((key) => key.startsWith("row:")).length).toBe(2);
  });

  it("removes rows and respects allowAddRows", async () => {
    const user = userEvent.setup();
    const view = render(<Harness config={base} />);
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(state["rowRemoved:r1"]).toBe(true);
    expect(field("Item, row 1").value).toBe("Juice");
    expect(total()).toBe("3.5");
    view.unmount();
    render(<Harness config={{ ...base, allowAddRows: false }} />);
    expect(screen.queryByRole("button", { name: /Add row/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove row 1" })).toBeNull();
  });

  it("adds, renames and removes columns when allowed", async () => {
    const user = userEvent.setup();
    render(<Harness config={{ ...base, allowAddColumns: true }} />);
    await user.click(screen.getByRole("button", { name: /Add column/ }));
    await user.type(screen.getByLabelText("Column name"), "Price");
    await user.selectOptions(screen.getByLabelText("Column type"), "number");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const colKey = Object.keys(state).find((key) => key.startsWith("col:"));
    expect(state[colKey ?? ""]).toMatchObject({ label: "Price", type: "number" });
    await user.type(field("Price, row 1"), "10");
    await user.tab();
    expect(screen.getByLabelText("Total Price").textContent).toBe("10");

    const header = screen.getByLabelText("Rename column Item");
    await user.clear(header);
    await user.type(header, "Thing{Enter}");
    expect(state["col:item"]).toMatchObject({ label: "Thing" });
    expect(field("Thing, row 1").value).toBe("Bread");
    await user.click(screen.getByRole("button", { name: "Remove column Kind" }));
    expect(state["colRemoved:kind"]).toBe(true);
    expect(screen.queryByLabelText("Kind, row 1")).toBeNull();
  });

  it("applies state over config and orders member-added rows", () => {
    render(
      <Harness
        config={base}
        initial={{
          "cell:r1:item": "Rye bread",
          "cell:r2:qty": null,
          "rowRemoved:r2": true,
          "row:b": { createdAt: 20 },
          "row:a": { createdAt: 10 },
          "cell:a:item": "First added",
          "cell:b:item": "Second added",
          "cell:a:qty": 1,
          "cell:a:who": { id: "gone", name: "Cem Kaya" },
        }}
      />,
    );
    expect([1, 2, 3].map((n) => field(`Item, row ${n}`).value)).toEqual([
      "Rye bread",
      "First added",
      "Second added",
    ]);
    expect(total()).toBe("3");
    expect(screen.getByText("Cem Kaya")).toBeTruthy();
  });

  it("survives garbage state", () => {
    const garbage = {
      "cell:r1:item": { nested: true },
      "cell:r1:qty": "abc",
      "cell:r1:who": 12,
      "cell:r1:kind": ["x"],
      "cell:r1:ok": "true",
      "cell:r2:qty": "7",
      "cell:r2:who": { id: 3, name: "Loose" },
      "cell:r2:kind": "Unknown choice",
      "cell:zz": 1,
      "row:x": 5,
      "row:y": true,
      "row:a:b": { createdAt: 1 },
      "col:c1": "label",
      "col:c2": { label: "Extra", type: "rocket", options: "no" },
      "col:c3": { label: "Pick", type: "select", options: [] },
      "rowRemoved:r1": "yes",
      "colRemoved:item": 0,
    } as unknown as ToolState;
    render(<Harness config={base} initial={garbage} />);
    expect(field("Item, row 1").value).toBe("");
    expect(field("Qty, row 1").value).toBe("");
    expect(field("Packed, row 1").checked).toBe(false);
    expect(total()).toBe("7");
    expect((screen.getByLabelText("Kind, row 2") as HTMLSelectElement).value).toBe(
      "Unknown choice",
    );
    expect(screen.getByText("Loose")).toBeTruthy();
    expect(field("Extra, row 3").value).toBe("");
    expect(field("Pick, row 3").type).toBe("text");
  });
});
