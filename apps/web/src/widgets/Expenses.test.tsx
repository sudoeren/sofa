import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import { type ExpensesConfig, getWidgetDef, type WidgetDef } from "@sofra/widgets";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@sofra/widgets/defs/expenses";
import { Expenses } from "./Expenses";

const me: MemberInfo = { id: "m1", name: "Mert", color: "#aa3355" };
const def = getWidgetDef("expenses") as WidgetDef<ExpensesConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: ExpensesConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Expenses
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
  currency: "EUR",
  people: [
    { id: "ada", name: "Ada" },
    { id: "deniz", name: "Deniz" },
  ],
});
const eur = (minor: number) => formatMoney(minor, "EUR");
const balances = () => within(screen.getByRole("region", { name: "Balances" }));
const settleUp = () => within(screen.getByRole("region", { name: "Settle up" }));
/** "Ada +€45.00" style text of every balance row */
const balanceRows = () =>
  balances()
    .getAllByRole("listitem")
    .map((li) => {
      const input = li.querySelector("input") as HTMLInputElement | null;
      const name = input
        ? input.value
        : (li.querySelector(".ex-person-left")?.textContent ?? "").trim();
      return `${name} ${li.querySelector(".ex-net")?.textContent}`;
    });

async function addExpense(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  amount: string,
  payer?: string,
) {
  await user.click(screen.getByRole("button", { name: "Add expense" }));
  const form = within(screen.getByRole("form", { name: "New expense" }));
  await user.type(form.getByLabelText("Title"), title);
  await user.type(form.getByLabelText("Amount in EUR"), amount);
  if (payer) await user.selectOptions(form.getByLabelText("Paid by"), payer);
  return form;
}

afterEach(cleanup);

describe("Expenses", () => {
  it("renders the starter", () => {
    render(<Harness config={def.configSchema.parse(def.starter.config)} />);
    expect(screen.getByText("Cave hotel, two nights")).toBeTruthy();
    expect(screen.getByText(formatMoney(69500, "EUR"))).toBeTruthy();
    expect(settleUp().getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("adds an expense and shows balances and settlements", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    expect(settleUp().getByText("Nothing to settle yet.")).toBeTruthy();

    const form = await addExpense(user, "Dinner", "90", "Ada");
    await user.click(form.getByRole("button", { name: "Add" }));

    const stored = Object.entries(state).find(([key]) => key.startsWith("expense:"));
    expect(stored?.[1]).toEqual({
      title: "Dinner",
      amount: 90,
      paidBy: "ada",
      splitBetween: null,
      order: 0,
    });
    expect(screen.getByRole("button", { name: "Edit Dinner" }).textContent).toContain(eur(9000));
    expect(balanceRows()).toEqual([`Ada +${eur(4500)}`, `Deniz −${eur(4500)}`]);
    const payment = settleUp().getByRole("listitem");
    expect(payment.textContent?.replace(/\s+/g, " ")).toBe(`Deniz pays Ada${eur(4500)}`);
  });

  it("lets a member join with one click and re-splits between everyone", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        config={base}
        initial={{
          "expense:x": { title: "Dinner", amount: 90, paidBy: "ada", splitBetween: null, order: 0 },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add me" }));
    expect(state["person:m1"]).toEqual({ name: "Mert", order: 0 });
    expect(screen.queryByRole("button", { name: "Add me" })).toBeNull();
    expect(balanceRows()).toEqual([
      `Ada +${eur(6000)}`,
      `Deniz −${eur(3000)}`,
      `Mert −${eur(3000)}`,
    ]);
    expect(settleUp().getAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByLabelText("Name of the person to add"), "Selin{Enter}");
    expect(balanceRows()).toHaveLength(4);
    expect(balanceRows()[0]).toBe(`Ada +${eur(6750)}`);
  });

  it("splits between a chosen subset, edits and deletes", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} initial={{ "person:m1": { name: "Mert", order: 0 } }} />);
    const form = await addExpense(user, "Taxi", "10,01", "Deniz");
    await user.click(form.getByRole("button", { name: "Mert" }));
    expect(form.getByRole("button", { name: "Mert" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(form.getByRole("button", { name: "Add" }));

    const [key, value] = Object.entries(state).find(([k]) => k.startsWith("expense:")) ?? [];
    expect(value).toMatchObject({ amount: 10.01, paidBy: "deniz", splitBetween: ["ada", "deniz"] });
    // 1001 split in two: the shares differ by one cent and sum to the amount
    const nets = balanceRows();
    expect(nets[2]).toBe("Mert even");
    expect([`Ada −${eur(500)}`, `Ada −${eur(501)}`]).toContain(nets[0]);

    await user.click(screen.getByRole("button", { name: "Edit Taxi" }));
    const edit = within(screen.getByRole("form", { name: "Edit Taxi" }));
    const amount = edit.getByLabelText("Amount in EUR") as HTMLInputElement;
    expect(amount.value).toBe("10.01");
    await user.clear(amount);
    await user.type(amount, "0");
    await user.click(edit.getByRole("button", { name: "Save" }));
    expect(edit.getByRole("alert").textContent).toBe("Enter an amount above zero.");
    await user.clear(amount);
    await user.type(amount, "30");
    await user.click(edit.getByRole("button", { name: "Mert" }));
    await user.click(edit.getByRole("button", { name: "Save" }));
    expect(state[key ?? ""]).toMatchObject({ amount: 30, splitBetween: null });
    expect(balanceRows()).toEqual([
      `Ada −${eur(1000)}`,
      `Deniz +${eur(2000)}`,
      `Mert −${eur(1000)}`,
    ]);

    await user.click(screen.getByRole("button", { name: "Edit Taxi" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(key && key in state).toBe(false);
    expect(settleUp().getByText("Nothing to settle yet.")).toBeTruthy();
  });

  it("hides a deleted config expense with a tombstone and keeps removed people who are owed", async () => {
    const user = userEvent.setup();
    const config = def.configSchema.parse({
      ...base,
      expenses: [
        { id: "e1", title: "Hotel", amount: 100, paidBy: "ada" },
        { id: "e2", title: "Fuel", amount: 40, paidBy: "deniz" },
      ],
    });
    render(<Harness config={config} />);
    await user.click(screen.getByRole("button", { name: "Edit Fuel" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(state["removed:expense:e2"]).toBe(true);
    expect(screen.queryByText("Fuel")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove Ada" }));
    expect(state["removed:person:ada"]).toBe(true);
    // Ada paid 100, now shared by Deniz alone
    expect(balanceRows()).toEqual([`Deniz −${eur(10000)}`, `Ada removed +${eur(10000)}`]);
    await user.click(screen.getByRole("button", { name: "Add Ada back" }));
    expect("removed:person:ada" in state).toBe(false);
    expect(balanceRows()).toEqual([`Ada +${eur(5000)}`, `Deniz −${eur(5000)}`]);
  });

  it("renames a person inline", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    const input = screen.getByLabelText("Name of Ada");
    await user.clear(input);
    await user.type(input, "Ada L.{Enter}");
    expect(state["person:ada"]).toEqual({ name: "Ada L.", order: 0 });
    const again = screen.getByLabelText("Name of Ada L.") as HTMLInputElement;
    await user.clear(again);
    await user.tab();
    expect((screen.getByLabelText("Name of Ada L.") as HTMLInputElement).value).toBe("Ada L.");
  });

  it("does not crash on hostile state", () => {
    const garbage: ToolState = {
      "person:": { name: "x" },
      "person:p1": "string",
      "person:p2": { name: { a: 1 }, order: "x" },
      "person:ada": 42,
      "removed:person:deniz": "true",
      "expense:a": null,
      "expense:b": { title: 5, amount: "9", paidBy: [] },
      "expense:c": {
        title: "Ghost",
        amount: 12.345,
        paidBy: "nobody",
        splitBetween: ["nope", 3, null],
      },
      "expense:d": { title: "Huge", amount: 1e300, paidBy: "ada" },
      "expense:e": [1, 2, 3],
      "removed:expense:c": { yes: true },
      something: { else: true },
    };
    render(<Harness config={base} initial={garbage} />);
    expect(screen.getByText("Ghost")).toBeTruthy();
    expect(balanceRows()).toHaveLength(4);
    render(<Harness config={{} as ExpensesConfig} initial={garbage} />);
  });
});
