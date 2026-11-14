import type { JsonValue, ToolState } from "@sofa/shared";
import { z } from "zod";
import type { WidgetDef } from "../types";

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "id must be 1-40 characters of letters, digits, _ or -");

const personSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
});

const expenseSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(80),
  /** in major units of the currency, e.g. 42.5 */
  amount: z.number().positive().max(1_000_000_000),
  paidBy: idSchema,
  /** person ids; omitted = everyone taking part */
  splitBetween: z.array(idSchema).min(1).max(50).optional(),
});

const configSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/, "currency must be a three-letter ISO 4217 code")
      .transform((code) => code.toUpperCase())
      .default("EUR"),
    people: z.array(personSchema).max(50).default([]),
    expenses: z.array(expenseSchema).max(200).default([]),
  })
  .superRefine((config, ctx) => {
    const people = new Set<string>();
    for (const [index, person] of config.people.entries()) {
      if (people.has(person.id)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate person id",
          path: ["people", index, "id"],
        });
      }
      people.add(person.id);
    }
    const seen = new Set<string>();
    for (const [index, expense] of config.expenses.entries()) {
      if (seen.has(expense.id)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate expense id",
          path: ["expenses", index, "id"],
        });
      }
      seen.add(expense.id);
      if (!people.has(expense.paidBy)) {
        ctx.addIssue({
          code: "custom",
          message: "paidBy must be the id of an entry in people",
          path: ["expenses", index, "paidBy"],
        });
      }
      for (const [at, id] of (expense.splitBetween ?? []).entries()) {
        if (!people.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: "splitBetween must only list ids from people",
            path: ["expenses", index, "splitBetween", at],
          });
        }
      }
    }
  });

export type ExpensesConfig = z.infer<typeof configSchema>;

/* ---------------------------------------------------------------- money */

const MAX_MINOR = 1e14;

/** Number of decimal places of a currency (2 for EUR, 0 for JPY); 2 when unknown. */
export function currencyDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
    return typeof digits === "number" && digits >= 0 && digits <= 4 ? digits : 2;
  } catch {
    return 2;
  }
}

/** Major units (12.5) to integer minor units (1250). Null for anything that is not a positive amount. */
export function toMinor(amount: unknown, digits: number): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const minor = Math.round(amount * 10 ** digits);
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MINOR) return null;
  return minor;
}

export function fromMinor(minor: number, digits: number): number {
  return minor / 10 ** digits;
}

/**
 * Parse what a person typed ("12,50", "1.234,50", "1,234.50", "40") into minor units.
 * Null when it is not a positive amount.
 */
export function parseAmountInput(text: string, digits: number): number | null {
  const raw = text.replace(/[\s ']/g, "");
  if (!/^\d[\d.,]*$/.test(raw) && !/^[.,]\d+$/.test(raw)) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalized = `${raw.slice(0, decimalAt).replace(/[.,]/g, "")}.${raw.slice(decimalAt + 1)}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = raw.split(separator);
    const last = parts[parts.length - 1] ?? "";
    const grouped =
      parts.length > 2 ||
      (last.length === 3 && digits !== 3 && /^[1-9]\d{0,2}$/.test(parts[0] ?? ""));
    normalized = grouped ? parts.join("") : `${parts[0] ?? ""}.${last}`;
  } else {
    normalized = raw;
  }
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === "" || normalized === ".") return null;
  return toMinor(Number(normalized), digits);
}

export function formatMoney(minor: number, currency: string, locale = "en"): string {
  const digits = currencyDigits(currency);
  const value = fromMinor(minor, digits);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** Plain number for an input field, e.g. 1250 -> "12.50". */
export function minorToInput(minor: number, digits: number): string {
  return fromMinor(minor, digits).toFixed(digits);
}

/* ---------------------------------------------------------------- split and settle */

export type Share = { id: string; amount: number };

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function seedOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 9973;
  return sum;
}

/**
 * Split an integer amount equally. The shares always sum to the amount: the leftover minor
 * units go one each to consecutive people (sorted by id), starting at `seed` so the same
 * person does not carry the remainder of every expense. Empty for invalid input.
 */
export function splitShares(amountMinor: number, ids: string[], seed = 0): Share[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return [];
  const sorted = [...new Set(ids)].sort(compareIds);
  const count = sorted.length;
  if (count === 0) return [];
  const base = Math.floor(amountMinor / count);
  const remainder = amountMinor - base * count;
  const start = ((Math.trunc(seed) % count) + count) % count;
  return sorted.map((id, index) => {
    const offset = (index - start + count) % count;
    return { id, amount: base + (offset < remainder ? 1 : 0) };
  });
}

export type ExpensePerson = {
  id: string;
  name: string;
  /** removed people keep their name and stay in expenses that reference them */
  removed: boolean;
  fromConfig: boolean;
  order: number;
};

export type ExpenseEntry = {
  id: string;
  title: string;
  amountMinor: number;
  paidBy: string;
  /** null = everyone currently taking part */
  splitBetween: string[] | null;
  fromConfig: boolean;
  order: number;
};

export type Balance = { id: string; paid: number; share: number; net: number };

/** Who shares an expense: the listed people, or everyone taking part when none are listed. */
export function sharersOf(
  expense: Pick<ExpenseEntry, "splitBetween">,
  activeIds: string[],
): string[] {
  const listed = expense.splitBetween ? [...new Set(expense.splitBetween)] : [];
  return listed.length > 0 ? listed : [...new Set(activeIds)];
}

/**
 * Paid minus share per person, in minor units. Every active person gets a row; people
 * who are no longer active but are referenced by an expense (payer or listed sharer) get
 * one too, so nets always sum to zero. Expenses nobody shares are skipped.
 */
export function computeBalances(
  expenses: Pick<ExpenseEntry, "id" | "amountMinor" | "paidBy" | "splitBetween">[],
  activeIds: string[],
): Balance[] {
  const rows = new Map<string, Balance>();
  const row = (id: string): Balance => {
    let found = rows.get(id);
    if (!found) {
      found = { id, paid: 0, share: 0, net: 0 };
      rows.set(id, found);
    }
    return found;
  };
  for (const id of activeIds) row(id);
  for (const expense of expenses) {
    const shares = splitShares(
      expense.amountMinor,
      sharersOf(expense, activeIds),
      seedOf(expense.id),
    );
    if (shares.length === 0) continue;
    row(expense.paidBy).paid += expense.amountMinor;
    for (const share of shares) row(share.id).share += share.amount;
  }
  const out = [...rows.values()];
  for (const balance of out) balance.net = balance.paid - balance.share;
  return out;
}

export type Settlement = { from: string; to: string; amount: number };

/**
 * Greedy settlement: the person who owes the most pays the person who is owed the most,
 * repeated until everyone is even. At most (people - 1) payments. Ties break by id so
 * every client shows the same list.
 */
export function settle(balances: Pick<Balance, "id" | "net">[]): Settlement[] {
  const open = balances
    .filter((b) => Number.isSafeInteger(b.net) && b.net !== 0)
    .map((b) => ({ id: b.id, net: b.net }));
  const out: Settlement[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const debtors = open
      .filter((b) => b.net < 0)
      .sort((a, b) => a.net - b.net || compareIds(a.id, b.id));
    const creditors = open
      .filter((b) => b.net > 0)
      .sort((a, b) => b.net - a.net || compareIds(a.id, b.id));
    const debtor = debtors[0];
    const creditor = creditors[0];
    if (!debtor || !creditor) break;
    const amount = Math.min(-debtor.net, creditor.net);
    out.push({ from: debtor.id, to: creditor.id, amount });
    debtor.net += amount;
    creditor.net -= amount;
  }
  return out;
}

/* ---------------------------------------------------------------- state */

/** A config list, or an empty one when the config is missing it (never trust the shape). */
function listOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type ExpensesView = {
  currency: string;
  digits: number;
  /** config order, then people added by members; includes removed people */
  people: ExpensePerson[];
  expenses: ExpenseEntry[];
};

const MAX_PEOPLE = 200;
const MAX_EXPENSES = 1000;

/** Merge config and shared state into what the widget shows. Never throws on bad state. */
export function resolveExpenses(config: ExpensesConfig, data: ToolState): ExpensesView {
  const currency =
    typeof config?.currency === "string" && config.currency ? config.currency : "EUR";
  const digits = currencyDigits(currency);

  const people: ExpensePerson[] = [];
  const configPeople = new Set<string>();
  for (const [index, person] of listOf(config?.people).entries()) {
    const override = data[`person:${person.id}`];
    const renamed = isRecord(override) ? cleanText(override.name, 40) : "";
    configPeople.add(person.id);
    people.push({
      id: person.id,
      name: renamed || person.name,
      removed: data[`removed:person:${person.id}`] === true,
      fromConfig: true,
      order: index,
    });
  }
  const added: ExpensePerson[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("person:")) continue;
    const id = key.slice("person:".length);
    if (!id || configPeople.has(id) || !isRecord(value)) continue;
    const name = cleanText(value.name, 40);
    if (!name) continue;
    added.push({
      id,
      name,
      removed: data[`removed:person:${id}`] === true,
      fromConfig: false,
      order: cleanOrder(value.order),
    });
  }
  added.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  people.push(...added.slice(0, MAX_PEOPLE));

  const parse = (
    id: string,
    value: JsonValue | undefined,
    fromConfig: boolean,
  ): ExpenseEntry | null => {
    if (!isRecord(value)) return null;
    const amountMinor = toMinor(value.amount, digits);
    const paidBy = typeof value.paidBy === "string" ? value.paidBy : "";
    if (amountMinor === null || !paidBy) return null;
    const split = Array.isArray(value.splitBetween)
      ? value.splitBetween.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    return {
      id,
      title: cleanText(value.title, 80) || "Untitled",
      amountMinor,
      paidBy,
      splitBetween: split.length > 0 ? [...new Set(split)] : null,
      fromConfig,
      order: cleanOrder(value.order),
    };
  };

  const expenses: ExpenseEntry[] = [];
  const configExpenses = new Set<string>();
  for (const [index, expense] of listOf(config?.expenses).entries()) {
    configExpenses.add(expense.id);
    if (data[`removed:expense:${expense.id}`] === true) continue;
    const amountMinor = toMinor(expense.amount, digits);
    const base: ExpenseEntry | null =
      amountMinor === null
        ? null
        : {
            id: expense.id,
            title: expense.title,
            amountMinor,
            paidBy: expense.paidBy,
            splitBetween: expense.splitBetween?.length ? [...new Set(expense.splitBetween)] : null,
            fromConfig: true,
            order: index,
          };
    const edited = parse(expense.id, data[`expense:${expense.id}`], true);
    const entry = edited ? { ...edited, order: index } : base;
    if (entry) expenses.push(entry);
  }
  const addedExpenses: ExpenseEntry[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("expense:")) continue;
    const id = key.slice("expense:".length);
    if (!id || configExpenses.has(id)) continue;
    const entry = parse(id, value, false);
    if (entry) addedExpenses.push(entry);
  }
  addedExpenses.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  expenses.push(...addedExpenses.slice(0, MAX_EXPENSES));

  return { currency, digits, people, expenses };
}

/* ---------------------------------------------------------------- definition */

export const expenses: WidgetDef<ExpensesConfig> = {
  type: "expenses",
  title: "Expense split",
  description: "Track who paid for what and see who owes whom.",
  guide: [
    "Use for shared costs: trips, dinners, flat bills, gifts. Shows each person's balance and the fewest payments that settle up.",
    'config.currency: ISO 4217 code such as "EUR", "USD", "TRY" (default "EUR").',
    "config.people: [{id, name}] initial participants; they need not be members of the space.",
    "config.expenses: [{id, title, amount, paidBy, splitBetween?}] initial entries. amount is a positive number in major units (12.5). paidBy is a person id. splitBetween is a list of person ids; omit it to split between everyone taking part. Splits are always equal.",
    "State keys (ids are short strings; a member who joins uses their member id as person id):",
    '"person:<id>" = {name, order}: a participant added by a member, or a new name for a config person.',
    '"removed:person:<id>" = true: participant removed (still counted in expenses that name them).',
    '"expense:<id>" = {title, amount, paidBy, splitBetween, order}: an added expense, or an edited version of a config expense with the same id. amount in major units; splitBetween is a list of person ids or null for everyone; order is a number, added entries sort ascending after the config entries.',
    '"removed:expense:<id>" = true: a config expense that was deleted (added ones are deleted by removing their key).',
    "Balances and settlements are derived, never stored.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Cappadocia weekend costs",
    description: "Add what you paid for; the balances and who pays whom update on their own.",
    config: {
      currency: "EUR",
      people: [
        { id: "ada", name: "Ada" },
        { id: "deniz", name: "Deniz" },
        { id: "mert", name: "Mert" },
        { id: "selin", name: "Selin" },
      ],
      expenses: [
        { id: "hotel", title: "Cave hotel, two nights", amount: 240, paidBy: "ada" },
        { id: "car", title: "Rental car", amount: 90, paidBy: "deniz" },
        {
          id: "balloon",
          title: "Balloon flight tickets",
          amount: 275,
          paidBy: "selin",
          splitBetween: ["ada", "deniz", "selin"],
        },
        { id: "dinner", title: "Dinner in Goreme", amount: 55, paidBy: "mert" },
        { id: "fuel", title: "Fuel", amount: 35, paidBy: "deniz" },
      ],
    },
  },
  keywords: [
    "expense",
    "expenses",
    "split",
    "bill",
    "cost",
    "costs",
    "money",
    "owe",
    "owes",
    "settle",
    "budget",
    "pay",
    "paid",
    "masraf",
    "hesap",
    "harcama",
    "borc",
    "odeme",
  ],
};
