import { describe, expect, it } from "vitest";
import {
  computeBalances,
  currencyDigits,
  expenses,
  formatMoney,
  parseAmountInput,
  resolveExpenses,
  settle,
  splitShares,
  toMinor,
} from "./expenses";

const schema = expenses.configSchema;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("expenses config", () => {
  it("accepts the starter", () => {
    expect(schema.safeParse(expenses.starter.config).success).toBe(true);
  });

  it("applies defaults", () => {
    expect(schema.parse({})).toEqual({ currency: "EUR", people: [], expenses: [] });
    expect(schema.parse({ currency: "try" }).currency).toBe("TRY");
  });

  it("rejects malformed input", () => {
    const people = [{ id: "a", name: "Ada" }];
    const bad = [
      { currency: "EURO" },
      { currency: 5 },
      { people: [{ id: "a b", name: "Ada" }] },
      { people: [{ id: "a", name: "" }] },
      { people: [...people, ...people] },
      { people, expenses: [{ id: "e", title: "x", amount: 0, paidBy: "a" }] },
      { people, expenses: [{ id: "e", title: "x", amount: -4, paidBy: "a" }] },
      { people, expenses: [{ id: "e", title: "x", amount: "12", paidBy: "a" }] },
      {
        people,
        expenses: [{ id: "e", title: "x", amount: Number.POSITIVE_INFINITY, paidBy: "a" }],
      },
      { people, expenses: [{ id: "e", title: "x", amount: 5, paidBy: "nobody" }] },
      { people, expenses: [{ id: "e", title: "x", amount: 5, paidBy: "a", splitBetween: ["zz"] }] },
      { people, expenses: [{ id: "e", title: "x", amount: 5, paidBy: "a", splitBetween: [] }] },
      { people: Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, name: "P" })) },
      "nope",
      null,
    ];
    for (const input of bad)
      expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and keywords", () => {
    const lines = expenses.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    expect(expenses.keywords).toContain("masraf");
    for (const word of expenses.keywords) expect(word).toBe(word.toLowerCase());
  });
});

describe("money", () => {
  it("knows currency digits", () => {
    expect(currencyDigits("EUR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("not a currency")).toBe(2);
  });

  it("converts to minor units and rejects non-amounts", () => {
    expect(toMinor(12.5, 2)).toBe(1250);
    expect(toMinor(0.1 + 0.2, 2)).toBe(30);
    expect(toMinor(19.99, 2)).toBe(1999);
    expect(toMinor(1200, 0)).toBe(1200);
    expect(toMinor(0, 2)).toBeNull();
    expect(toMinor(0.001, 2)).toBeNull();
    expect(toMinor(-5, 2)).toBeNull();
    expect(toMinor(Number.NaN, 2)).toBeNull();
    expect(toMinor(Number.POSITIVE_INFINITY, 2)).toBeNull();
    expect(toMinor(1e30, 2)).toBeNull();
    expect(toMinor("12", 2)).toBeNull();
    expect(toMinor(null, 2)).toBeNull();
  });

  it("parses typed amounts", () => {
    expect(parseAmountInput("12", 2)).toBe(1200);
    expect(parseAmountInput("12.5", 2)).toBe(1250);
    expect(parseAmountInput("12,50", 2)).toBe(1250);
    expect(parseAmountInput(" 1 234,50 ", 2)).toBe(123450);
    expect(parseAmountInput("1.234,50", 2)).toBe(123450);
    expect(parseAmountInput("1,234.50", 2)).toBe(123450);
    expect(parseAmountInput("1,234", 2)).toBe(123400);
    expect(parseAmountInput("1.234.567", 2)).toBe(123456700);
    expect(parseAmountInput(".5", 2)).toBe(50);
    expect(parseAmountInput("19.999", 2)).toBe(1999900);
    expect(parseAmountInput("0.129", 2)).toBe(13);
    expect(parseAmountInput("1500", 0)).toBe(1500);
    for (const bad of ["", "0", "0,00", "-5", "abc", "12a", "1e5", ".", ",", "--", "5-"]) {
      expect(parseAmountInput(bad, 2), bad).toBeNull();
    }
  });

  it("formats money", () => {
    expect(formatMoney(24000, "USD", "en-US")).toBe("$240.00");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
    expect(formatMoney(100, "bogus")).toContain("1.00");
  });
});

describe("splitShares", () => {
  it("splits evenly when it divides", () => {
    expect(splitShares(900, ["a", "b", "c"])).toEqual([
      { id: "a", amount: 300 },
      { id: "b", amount: 300 },
      { id: "c", amount: 300 },
    ]);
  });

  it("hands out the remainder one unit at a time and always sums to the amount", () => {
    expect(splitShares(1000, ["c", "a", "b"]).map((s) => s.amount)).toEqual([334, 333, 333]);
    expect(splitShares(1000, ["a", "b", "c"], 1).map((s) => s.amount)).toEqual([333, 334, 333]);
    expect(splitShares(1001, ["a", "b", "c"], 2).map((s) => s.amount)).toEqual([334, 333, 334]);
    for (let amount = 1; amount < 400; amount += 7) {
      for (let people = 1; people <= 9; people++) {
        const ids = Array.from({ length: people }, (_, i) => `p${i}`);
        for (const seed of [0, 1, 5, 9972, -3]) {
          const shares = splitShares(amount, ids, seed);
          expect(sum(shares.map((s) => s.amount))).toBe(amount);
          const values = shares.map((s) => s.amount);
          expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("does not depend on the order of the ids and ignores duplicates", () => {
    expect(splitShares(100, ["b", "a", "c", "a"], 4)).toEqual(splitShares(100, ["c", "b", "a"], 4));
  });

  it("gives a single person everything, even one unit among many", () => {
    expect(splitShares(1, ["a", "b", "c"]).map((s) => s.amount)).toEqual([1, 0, 0]);
    expect(splitShares(77, ["a"])).toEqual([{ id: "a", amount: 77 }]);
  });

  it("rejects zero, negative, fractional amounts and empty groups", () => {
    expect(splitShares(0, ["a"])).toEqual([]);
    expect(splitShares(-100, ["a", "b"])).toEqual([]);
    expect(splitShares(10.5, ["a", "b"])).toEqual([]);
    expect(splitShares(Number.NaN, ["a"])).toEqual([]);
    expect(splitShares(100, [])).toEqual([]);
  });
});

const entry = (
  id: string,
  amountMinor: number,
  paidBy: string,
  splitBetween: string[] | null = null,
) => ({
  id,
  amountMinor,
  paidBy,
  splitBetween,
});
const nets = (balances: { id: string; net: number }[]) =>
  Object.fromEntries(balances.map((b) => [b.id, b.net]));

describe("computeBalances and settle", () => {
  it("single payer: everyone else owes their share", () => {
    const balances = computeBalances([entry("e1", 9000, "a")], ["a", "b", "c"]);
    expect(nets(balances)).toEqual({ a: 6000, b: -3000, c: -3000 });
    expect(settle(balances)).toEqual([
      { from: "b", to: "a", amount: 3000 },
      { from: "c", to: "a", amount: 3000 },
    ]);
  });

  it("everyone even: no settlements", () => {
    const balances = computeBalances(
      [entry("e1", 3000, "a"), entry("e2", 3000, "b"), entry("e3", 3000, "c")],
      ["a", "b", "c"],
    );
    expect(nets(balances)).toEqual({ a: 0, b: 0, c: 0 });
    expect(settle(balances)).toEqual([]);
  });

  it("nets sum to zero with remainders and subsets", () => {
    const balances = computeBalances(
      [
        entry("dinner", 10000, "a"),
        entry("taxi", 1001, "b", ["a", "b"]),
        entry("coffee", 700, "c", ["c"]),
        entry("odd", 1, "d"),
      ],
      ["a", "b", "c", "d"],
    );
    expect(sum(balances.map((b) => b.net))).toBe(0);
    expect(sum(balances.map((b) => b.paid))).toBe(11702);
    expect(sum(balances.map((b) => b.share))).toBe(11702);
    const payments = settle(balances);
    expect(payments.length).toBeLessThanOrEqual(3);
    const after = nets(balances);
    for (const p of payments) {
      expect(p.amount).toBeGreaterThan(0);
      after[p.from] = (after[p.from] ?? 0) + p.amount;
      after[p.to] = (after[p.to] ?? 0) - p.amount;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it("settles greedily: the largest debtor pays the largest creditor", () => {
    const payments = settle([
      { id: "ada", net: -24000 },
      { id: "deniz", net: 30000 },
      { id: "mert", net: -10000 },
      { id: "selin", net: 4000 },
    ]);
    expect(payments).toEqual([
      { from: "ada", to: "deniz", amount: 24000 },
      { from: "mert", to: "deniz", amount: 6000 },
      { from: "mert", to: "selin", amount: 4000 },
    ]);
  });

  it("is deterministic on ties and ignores garbage balances", () => {
    const a = settle([
      { id: "x", net: -50 },
      { id: "y", net: -50 },
      { id: "p", net: 50 },
      { id: "q", net: 50 },
    ]);
    const b = settle([
      { id: "q", net: 50 },
      { id: "y", net: -50 },
      { id: "p", net: 50 },
      { id: "x", net: -50 },
    ]);
    expect(a).toEqual(b);
    expect(a).toEqual([
      { from: "x", to: "p", amount: 50 },
      { from: "y", to: "q", amount: 50 },
    ]);
    expect(
      settle([
        { id: "a", net: Number.NaN },
        { id: "b", net: 0.5 },
      ]),
    ).toEqual([]);
    expect(settle([{ id: "a", net: 10 }])).toEqual([]);
  });

  it("keeps people who were removed but are referenced by an expense", () => {
    // "gone" paid for something and is named in a split, but no longer takes part
    const balances = computeBalances(
      [entry("e1", 6000, "gone"), entry("e2", 3000, "a", ["a", "gone", "b"])],
      ["a", "b"],
    );
    expect(nets(balances)).toEqual({ a: -1000, b: -4000, gone: 5000 });
    expect(sum(balances.map((b) => b.net))).toBe(0);
    expect(settle(balances)).toEqual([
      { from: "b", to: "gone", amount: 4000 },
      { from: "a", to: "gone", amount: 1000 },
    ]);
  });

  it("skips expenses nobody shares and invalid amounts", () => {
    expect(computeBalances([entry("e1", 500, "a")], [])).toEqual([]);
    const balances = computeBalances([entry("e1", 0, "a"), entry("e2", -5, "b")], ["a", "b"]);
    expect(nets(balances)).toEqual({ a: 0, b: 0 });
  });
});

describe("resolveExpenses", () => {
  const config = schema.parse({
    currency: "EUR",
    people: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bora" },
    ],
    expenses: [
      { id: "e1", title: "Dinner", amount: 30, paidBy: "a" },
      { id: "e2", title: "Taxi", amount: 12.5, paidBy: "b", splitBetween: ["a"] },
    ],
  });

  it("reads the config when the state is empty", () => {
    const view = resolveExpenses(config, {});
    expect(view.people.map((p) => p.name)).toEqual(["Ada", "Bora"]);
    expect(view.expenses.map((e) => [e.id, e.amountMinor, e.splitBetween])).toEqual([
      ["e1", 3000, null],
      ["e2", 1250, ["a"]],
    ]);
  });

  it("applies edits, removals and additions in a stable order", () => {
    const view = resolveExpenses(config, {
      "person:a": { name: "Ada L." },
      "person:zed": { name: "Zed", order: 2 },
      "person:m1": { name: "Mia", order: 1 },
      "removed:person:b": true,
      "expense:e1": {
        title: "Big dinner",
        amount: 45,
        paidBy: "m1",
        splitBetween: null,
        order: 99,
      },
      "removed:expense:e2": true,
      "expense:x2": {
        title: "Late",
        amount: 3,
        paidBy: "a",
        splitBetween: ["a", "a", "zed"],
        order: 5,
      },
      "expense:x1": { title: "Early", amount: 2, paidBy: "a", order: 5 },
    });
    expect(view.people.map((p) => [p.id, p.name, p.removed])).toEqual([
      ["a", "Ada L.", false],
      ["b", "Bora", true],
      ["m1", "Mia", false],
      ["zed", "Zed", false],
    ]);
    expect(view.expenses.map((e) => [e.id, e.title, e.amountMinor, e.paidBy])).toEqual([
      ["e1", "Big dinner", 4500, "m1"],
      ["x1", "Early", 200, "a"],
      ["x2", "Late", 300, "a"],
    ]);
    expect(view.expenses[2]?.splitBetween).toEqual(["a", "zed"]);
  });

  it("survives garbage", () => {
    const view = resolveExpenses(config, {
      "person:": { name: "No id" },
      "person:x": "just a string",
      "person:y": { name: 42 },
      "person:a": [1, 2, 3],
      "removed:person:a": "yes",
      "expense:e1": { title: "Broken", amount: "a lot", paidBy: "a" },
      "expense:g1": null,
      "expense:g2": { title: "No payer", amount: 5 },
      "expense:g3": { title: "Negative", amount: -5, paidBy: "a" },
      "expense:g4": { amount: 5, paidBy: "a", splitBetween: "everyone", order: "first" },
      "expense:g5": { title: { nested: true }, amount: 1e40, paidBy: "a" },
      unrelated: { deep: [{ a: 1 }] },
    });
    expect(view.people.map((p) => [p.id, p.name, p.removed])).toEqual([
      ["a", "Ada", false],
      ["b", "Bora", false],
    ]);
    expect(view.expenses.map((e) => [e.id, e.title, e.amountMinor])).toEqual([
      ["e1", "Dinner", 3000],
      ["e2", "Taxi", 1250],
      ["g4", "Untitled", 500],
    ]);
  });
});
