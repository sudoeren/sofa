import type { JsonValue, MemberInfo, ToolState } from "@sofa/shared";
import { getWidgetDef, type SeatingConfig, type WidgetDef } from "@sofa/widgets";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Seating } from "./Seating";

const me: MemberInfo = { id: "m1", name: "Mert", color: "#aa3355" };
const def = getWidgetDef("seating") as WidgetDef<SeatingConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: SeatingConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Seating
      config={config}
      data={data}
      me={me}
      members={[me]}
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

const base = def.configSchema.parse({
  tables: [
    { id: "t1", name: "Small", seats: 1 },
    { id: "t2", name: "Large", seats: 3 },
  ],
  guests: [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bora" },
    { id: "c", name: "Cem" },
  ],
});
const area = (name: string) => screen.getByRole("region", { name });
const guestsIn = (name: string) =>
  [...area(name).querySelectorAll(".st-guest-name")].map((el) => el.textContent);
const guest = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}(, selected)?$`) });

afterEach(() => {
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe("Seating", () => {
  it("renders the starter", () => {
    render(
      <Harness
        config={def.configSchema.parse(def.starter.config)}
        initial={def.starter.initialState}
      />,
    );
    expect(guestsIn("Window table")).toEqual(["Leyla", "Omer", "Grandma Nur"]);
    expect(guestsIn("Unseated guests")).toHaveLength(7);
    expect(within(area("Window table")).getByText("3 free")).toBeTruthy();
  });

  it("seats a guest by selecting and choosing a table, and respects capacity", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    expect(guestsIn("Unseated guests")).toEqual(["Ada", "Bora", "Cem"]);
    expect(screen.queryByRole("button", { name: /^Seat / })).toBeNull();

    await user.click(guest("Ada"));
    expect(guest("Ada").getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Seat Ada at Small" }));
    expect(state["seat:a"]).toBe("t1");
    expect(guestsIn("Small")).toEqual(["Ada"]);
    expect(guestsIn("Unseated guests")).toEqual(["Bora", "Cem"]);
    expect(within(area("Small")).getByText("Full")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Seat / })).toBeNull();

    // the small table has one seat only
    await user.click(guest("Bora"));
    await user.click(screen.getByRole("button", { name: "Seat Bora at Small" }));
    expect("seat:b" in state).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("Full: the only seat is taken");
    expect(guestsIn("Small")).toEqual(["Ada"]);
    // still selected, so another table is one tap away
    await user.click(screen.getByRole("button", { name: "Seat Bora at Large" }));
    expect(state["seat:b"]).toBe("t2");
    expect(screen.queryByRole("status")).toBeNull();
    expect(guestsIn("Large")).toEqual(["Bora"]);

    // back to the pool
    await user.click(guest("Bora"));
    await user.click(screen.getByRole("button", { name: "Unseat Bora" }));
    expect("seat:b" in state).toBe(false);
    expect(guestsIn("Unseated guests")).toEqual(["Bora", "Cem"]);
  });

  it("moves a guest by dragging with the pointer", () => {
    render(<Harness config={base} initial={{ "seat:a": "t1" }} />);
    let under: Element | null = area("Large");
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => under;
    const drag = (name: string) => {
      const chip = guest(name);
      fireEvent.pointerDown(chip, {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 10,
        clientY: 10,
      });
      fireEvent.pointerMove(chip, { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 80 });
      expect(document.querySelector(".st-ghost")?.textContent).toBe(name);
      fireEvent.pointerUp(chip, { pointerId: 1, pointerType: "mouse", clientX: 60, clientY: 80 });
      fireEvent.click(chip);
      expect(document.querySelector(".st-ghost")).toBeNull();
    };

    drag("Cem");
    expect(state["seat:c"]).toBe("t2");
    // the click that ends a drag does not select the guest
    expect(guest("Cem").getAttribute("aria-pressed")).toBe("false");

    under = area("Small");
    drag("Bora");
    expect("seat:b" in state).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Full");

    under = area("Unseated guests");
    drag("Cem");
    expect("seat:c" in state).toBe(false);

    // a small wobble is a click, not a drag
    const chip = guest("Bora");
    fireEvent.pointerDown(chip, {
      pointerId: 2,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(chip, { pointerId: 2, pointerType: "mouse", clientX: 12, clientY: 11 });
    fireEvent.pointerUp(chip, { pointerId: 2, pointerType: "mouse", clientX: 12, clientY: 11 });
    fireEvent.click(chip);
    expect(guest("Bora").getAttribute("aria-pressed")).toBe("true");
  });

  it("adds, renames and removes guests and tables", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} initial={{ "seat:a": "t1", "seat:b": "t2" }} />);

    await user.type(screen.getByLabelText("Name of the guest to add"), "Dora{Enter}");
    expect(guestsIn("Unseated guests")).toEqual(["Cem", "Dora"]);
    await user.click(screen.getByRole("button", { name: "Add a table" }));
    expect(screen.getByRole("region", { name: "Table 3" })).toBeTruthy();
    const added = Object.entries(state).find(([key]) => key.startsWith("table:"));
    expect(added?.[1]).toEqual({ name: "Table 3", seats: 3, order: 0 });

    const tableName = screen.getByLabelText("Name of Small");
    await user.clear(tableName);
    await user.type(tableName, "Corner{Enter}");
    expect(state["table:t1"]).toEqual({ name: "Corner", seats: 1, order: 0 });
    await user.click(screen.getByRole("button", { name: "One seat more at Corner" }));
    expect(state["table:t1"]).toEqual({ name: "Corner", seats: 2, order: 0 });
    expect(within(area("Corner")).getByText("1 free")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "One seat fewer at Corner" }));
    expect(
      (screen.getByRole("button", { name: "One seat fewer at Corner" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.click(guest("Cem"));
    const guestName = screen.getByLabelText("Name of Cem");
    await user.clear(guestName);
    await user.type(guestName, "Cem B.{Enter}");
    expect(state["guest:c"]).toEqual({ name: "Cem B.", order: 2 });
    await user.click(screen.getByRole("button", { name: "Remove Cem B." }));
    expect(state["removed:guest:c"]).toBe(true);
    expect(guestsIn("Unseated guests")).toEqual(["Dora"]);

    // guests of a removed table return to the pool
    await user.click(screen.getByRole("button", { name: "Remove Corner" }));
    expect(state["removed:table:t1"]).toBe(true);
    expect(screen.queryByRole("region", { name: "Corner" })).toBeNull();
    expect(guestsIn("Unseated guests")).toEqual(["Ada", "Dora"]);
  });

  it("hides adding when allowAdd is off", () => {
    render(<Harness config={{ ...base, allowAdd: false }} />);
    expect(screen.queryByRole("button", { name: "Add a table" })).toBeNull();
    expect(screen.queryByLabelText("Name of the guest to add")).toBeNull();
  });

  it("does not crash on hostile state", () => {
    const garbage: ToolState = {
      "seat:a": { table: "t1" },
      "seat:b": "nowhere",
      "seat:c": "t1",
      "seat:x": "t1",
      "seat:y": "t1",
      "guest:x": { name: "Extra", order: "first" },
      "guest:y": { name: "Extra two" },
      "guest:z": 12,
      "guest:a": null,
      "table:t2": { name: [], seats: -4 },
      "table:new": { name: "Odd", seats: 2.6, order: {} },
      "table:bad": "table",
      "removed:table:t1": 0,
      junk: "x",
    };
    render(<Harness config={base} initial={garbage} />);
    // three guests on a one-seat table: shown, flagged as over capacity
    expect(guestsIn("Small")).toEqual(["Cem", "Extra", "Extra two"]);
    expect(within(area("Small")).getByText("Over by 2")).toBeTruthy();
    expect(within(area("Large")).getByText("0/1")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Odd" })).toBeTruthy();
    cleanup();
    render(<Harness config={{} as SeatingConfig} initial={garbage} />);
  });
});
