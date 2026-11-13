import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import { type ChecklistConfig, getWidgetDef, type WidgetDef } from "@sofra/widgets";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Checklist } from "./Checklist";

const me: MemberInfo = { id: "u1", name: "Ada Lovelace", color: "#aa3355" };
const bob: MemberInfo = { id: "u2", name: "Bob Stone", color: "#3355aa" };
const checklist = getWidgetDef("checklist") as WidgetDef<ChecklistConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: ChecklistConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Checklist
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

const base = checklist.configSchema.parse({
  items: [
    { id: "tent", text: "Tent", section: "Gear" },
    { id: "stove", text: "Camping stove", section: "Gear" },
    { id: "bread", text: "Bread", section: "Food" },
  ],
});
const texts = () =>
  screen.getAllByRole("listitem").map((li) => li.querySelector(".cl-text")?.textContent);
afterEach(cleanup);

describe("Checklist", () => {
  it("checks items off with who and when, and shows progress", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    expect(screen.getByText("0 of 3 done")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: "Done: Tent" });
    await user.click(box);
    expect(state["done:tent"]).toMatchObject({ by: "u1", name: "Ada Lovelace" });
    expect(typeof (state["done:tent"] as { at: number }).at).toBe("number");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.closest("li")?.className).toContain("is-done");
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    await user.click(box);
    expect("done:tent" in state).toBe(false);
  });

  it("claims, reassigns and unassigns", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.click(screen.getByRole("button", { name: "I'll do it: Tent" }));
    expect(state["claim:tent"]).toEqual({ id: "u1", name: "Ada Lovelace", color: "#aa3355" });
    const pick = screen.getByRole("combobox", { name: /Assigned to Ada Lovelace: Tent/ });
    await user.selectOptions(pick, "u2");
    expect(state["claim:tent"]).toMatchObject({ id: "u2", name: "Bob Stone" });
    await user.selectOptions(screen.getByRole("combobox", { name: /Assigned to Bob Stone/ }), "");
    expect("claim:tent" in state).toBe(false);
  });

  it("hides claiming when not assignable and progress when disabled", () => {
    render(
      <Harness
        config={{ ...base, assignable: false, showProgress: false }}
        initial={{ "claim:tent": { id: "u2", name: "Bob" } }}
      />,
    );
    expect(screen.queryByRole("button", { name: /I'll do it/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("adds an item to a section, edits and removes it", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.type(screen.getByLabelText("Add an item to Food"), "Olives{Enter}");
    const added = Object.entries(state).find(([key]) => key.startsWith("item:"));
    expect(added?.[1]).toMatchObject({ text: "Olives", section: "Food", by: "u1" });
    expect(texts()).toEqual(["Tent", "Camping stove", "Bread", "Olives"]);
    expect(screen.getByText("0 of 4 done")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit item: Camping stove" }));
    const input = screen.getByLabelText("Item text");
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.type(input, "Gas stove{Enter}");
    expect(state["item:stove"]).toMatchObject({ text: "Gas stove", section: "Gear" });

    expect(screen.queryByLabelText("Item text")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit item: Tent" }));
    await user.clear(screen.getByLabelText("Item text"));
    await user.tab();
    expect("item:tent" in state).toBe(false);
    expect(screen.getByRole("button", { name: "Edit item: Tent" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove item: Bread" }));
    expect(state["removed:bread"]).toBe(true);
    expect(texts()).toEqual(["Tent", "Gas stove", "Olives"]);
  });

  it("applies overrides, removals and ordering from state", () => {
    render(
      <Harness
        config={base}
        initial={{
          "item:tent": { text: "Big tent", createdAt: 1 },
          "removed:stove": true,
          "item:b": { text: "Later", createdAt: 20 },
          "item:a": { text: "Sooner", createdAt: 10, section: "Food" },
          "item:c": { text: "New section item", createdAt: 30, section: "Extras" },
          "done:b": { by: "gone", name: "Cem", at: 5 },
          "claim:tent": { id: "gone", name: "Cem Kaya" },
        }}
      />,
    );
    expect(texts()).toEqual(["Later", "Big tent", "Bread", "Sooner", "New section item"]);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Gear",
      "Food",
      "Extras",
    ]);
    expect(screen.getByText("1 of 5 done")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Assigned to Cem Kaya/ })).toBeTruthy();
  });

  it("survives garbage state", () => {
    const garbage = {
      "item:x": 3,
      "item:y": { text: 12 },
      "item:z": { text: "Valid", createdAt: "x", section: 9 },
      "item:tent": ["not", "an", "object"],
      "done:tent": "yes",
      "done:stove": true,
      "done:bread": null,
      "claim:tent": "u2",
      "claim:stove": { id: 5 },
      "claim:bread": { id: "zz", name: null },
      "removed:bread": 1,
      other: [[]],
    } as unknown as ToolState;
    render(<Harness config={base} initial={garbage} />);
    expect(texts()).toEqual(["Valid", "Tent", "Camping stove", "Bread"]);
    expect(screen.getByText("1 of 4 done")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Assigned to Someone: Bread/ })).toBeTruthy();
  });

  it("renders an empty list with an add row", () => {
    render(<Harness config={checklist.configSchema.parse({})} />);
    expect(screen.getByText("Nothing to do yet")).toBeTruthy();
    expect(screen.getByLabelText("Add an item")).toBeTruthy();
  });
});
