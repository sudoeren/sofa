import type { ExpensesConfig } from "@sofa/widgets";
import {
  computeBalances,
  type ExpenseEntry,
  type ExpensePerson,
  formatMoney,
  fromMinor,
  minorToInput,
  parseAmountInput,
  resolveExpenses,
  settle,
  sharersOf,
} from "@sofa/widgets/defs/expenses";
import { ArrowRight, Check, Plus, Trash2, Undo2, UserPlus, X } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { Avatar, InlineEdit, memberName, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./expenses.css";

type FormValues = {
  title: string;
  amountMinor: number;
  paidBy: string;
  splitBetween: string[] | null;
};

function nextOrder(items: { order: number; fromConfig: boolean }[]): number {
  let max = -1;
  for (const item of items) if (!item.fromConfig && item.order > max) max = item.order;
  return Math.floor(max) + 1;
}

export function Expenses({ config, data, set, del, me, members }: WidgetProps<ExpensesConfig>) {
  const view = useMemo(() => resolveExpenses(config, data), [config, data]);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // bumped when an empty name is refused, so the field shows the stored name again
  const [editKey, setEditKey] = useState(0);

  const { currency, digits, people, expenses } = view;
  const active = people.filter((person) => !person.removed);
  const activeIds = active.map((person) => person.id);
  const byId = new Map(people.map((person) => [person.id, person]));
  const colorOf = (id: string) => members.find((member) => member.id === id)?.color;
  const nameOf = (id: string) => byId.get(id)?.name ?? memberName(members, id, "Someone");
  const money = (minor: number) => formatMoney(minor, currency);

  const balances = computeBalances(expenses, activeIds);
  const netOf = new Map(balances.map((balance) => [balance.id, balance.net]));
  const payments = settle(balances);
  const counted = expenses.filter((expense) => sharersOf(expense, activeIds).length > 0);
  const total = counted.reduce((sum, expense) => sum + expense.amountMinor, 0);

  // People who left but still have money in play stay visible below the active ones.
  const extraIds = balances
    .filter(
      (balance) => !activeIds.includes(balance.id) && (balance.paid !== 0 || balance.share !== 0),
    )
    .map((balance) => balance.id);
  const rows: { id: string; name: string; person: ExpensePerson | null; removed: boolean }[] = [
    ...active.map((person) => ({ id: person.id, name: person.name, person, removed: false })),
    ...extraIds.map((id) => ({
      id,
      name: nameOf(id),
      person: byId.get(id) ?? null,
      removed: true,
    })),
  ];

  const meActive = activeIds.includes(me.id);

  function addPerson(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim().slice(0, 40);
    if (!name) return;
    set(`person:${newKeyId()}`, { name, order: nextOrder(people) });
    setNewName("");
  }

  function addMe() {
    const existing = byId.get(me.id);
    if (existing) {
      del(`removed:person:${me.id}`);
      return;
    }
    set(`person:${me.id}`, { name: me.name.trim().slice(0, 40) || "Me", order: nextOrder(people) });
  }

  function renamePerson(person: ExpensePerson, name: string) {
    if (!name) return setEditKey(editKey + 1);
    set(`person:${person.id}`, { name: name.slice(0, 40), order: person.order });
  }

  function saveExpense(id: string | null, values: FormValues) {
    const existing = id ? expenses.find((expense) => expense.id === id) : undefined;
    set(`expense:${id ?? newKeyId()}`, {
      title: values.title,
      amount: fromMinor(values.amountMinor, digits),
      paidBy: values.paidBy,
      splitBetween: values.splitBetween,
      order: existing ? existing.order : nextOrder(expenses),
    });
    setEditing(null);
  }

  function removeExpense(expense: ExpenseEntry) {
    if (expense.fromConfig) set(`removed:expense:${expense.id}`, true);
    else del(`expense:${expense.id}`);
    setEditing(null);
  }

  return (
    <div className="w-root ex-root">
      <div className="ex-summary">
        <div>
          <div className="w-small w-muted">Total spent</div>
          <div className="ex-total w-num">{money(total)}</div>
        </div>
        <div className="w-small w-muted ex-summary-meta">
          {counted.length} {counted.length === 1 ? "expense" : "expenses"}
          <br />
          {active.length} {active.length === 1 ? "person" : "people"}
        </div>
      </div>

      <div className="ex-columns">
        <section className="ex-section" aria-label="Expenses">
          <h4 className="ex-heading">Expenses</h4>
          {expenses.length === 0 && editing !== "new" ? (
            <div className="w-empty w-small">
              Nothing yet. Add the first thing someone paid for.
            </div>
          ) : (
            <ul className="ex-list">
              {expenses.map((expense) =>
                editing === expense.id ? (
                  <li key={expense.id}>
                    <ExpenseForm
                      expense={expense}
                      people={people}
                      digits={digits}
                      currency={currency}
                      defaultPayer=""
                      onSave={(values) => saveExpense(expense.id, values)}
                      onCancel={() => setEditing(null)}
                      onDelete={() => removeExpense(expense)}
                    />
                  </li>
                ) : (
                  <li key={expense.id} className="ex-item">
                    <button
                      type="button"
                      className="ex-item-main"
                      onClick={() => setEditing(expense.id)}
                      aria-label={`Edit ${expense.title}`}
                    >
                      <span className="w-grow ex-item-text">
                        <span className="ex-item-title">{expense.title}</span>
                        <span className="w-small w-muted ex-item-meta">
                          {nameOf(expense.paidBy)} paid
                          {" · "}
                          {splitLabel(expense, activeIds, nameOf)}
                        </span>
                      </span>
                      <span className="w-num w-strong ex-item-amount">
                        {money(expense.amountMinor)}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
          {editing === "new" ? (
            <ExpenseForm
              expense={null}
              people={people}
              digits={digits}
              currency={currency}
              defaultPayer={meActive ? me.id : (activeIds[0] ?? "")}
              onSave={(values) => saveExpense(null, values)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button type="button" className="w-btn ex-add" onClick={() => setEditing("new")}>
              <Plus size={15} aria-hidden="true" />
              Add expense
            </button>
          )}
        </section>

        <div className="ex-side">
          <section className="ex-section" aria-label="Balances">
            <h4 className="ex-heading">Balances</h4>
            {rows.length === 0 ? (
              <div className="w-small w-muted">Add the people who share the costs.</div>
            ) : (
              <ul className="ex-list">
                {rows.map((row) => {
                  const net = netOf.get(row.id) ?? 0;
                  const person = row.person;
                  return (
                    <li key={row.id} className="ex-person">
                      <Avatar member={{ name: row.name, color: colorOf(row.id) }} />
                      <span className="w-grow ex-person-name">
                        {person && !row.removed ? (
                          <InlineEdit
                            key={editKey}
                            value={row.name}
                            onCommit={(name) => renamePerson(person, name)}
                            ariaLabel={`Name of ${row.name}`}
                            maxLength={40}
                          />
                        ) : (
                          <span className="ex-person-left">
                            {row.name} <span className="w-chip">removed</span>
                          </span>
                        )}
                      </span>
                      <span
                        className={`w-num ex-net ${net > 0 ? "is-plus" : net < 0 ? "is-minus" : "is-even"}`}
                        title={net > 0 ? "Gets back" : net < 0 ? "Owes" : "Even"}
                      >
                        {net === 0 ? "even" : `${net > 0 ? "+" : "−"}${money(Math.abs(net))}`}
                      </span>
                      {row.removed ? (
                        person ? (
                          <button
                            type="button"
                            className="w-icon-btn"
                            aria-label={`Add ${row.name} back`}
                            title="Add back"
                            onClick={() => del(`removed:person:${row.id}`)}
                          >
                            <Undo2 size={14} aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="ex-spacer" />
                        )
                      ) : (
                        <button
                          type="button"
                          className="w-icon-btn ex-quiet"
                          aria-label={`Remove ${row.name}`}
                          title="Remove"
                          onClick={() => set(`removed:person:${row.id}`, true)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="ex-add-person" onSubmit={addPerson}>
              <input
                className="w-input"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Add a person"
                aria-label="Name of the person to add"
                maxLength={40}
              />
              <button
                type="submit"
                className="w-btn"
                disabled={!newName.trim()}
                aria-label="Add person"
              >
                <Plus size={15} aria-hidden="true" />
              </button>
              {!meActive && (
                <button type="button" className="w-btn ex-add-me" onClick={addMe}>
                  <UserPlus size={15} aria-hidden="true" />
                  Add me
                </button>
              )}
            </form>
          </section>

          <section className="ex-section" aria-label="Settle up">
            <h4 className="ex-heading">Settle up</h4>
            {payments.length === 0 ? (
              <div className="ex-settled w-small">
                <Check size={14} aria-hidden="true" />
                {counted.length === 0 ? "Nothing to settle yet." : "Everyone is even."}
              </div>
            ) : (
              <ul className="ex-list">
                {payments.map((payment) => (
                  <li key={`${payment.from}>${payment.to}`} className="ex-payment">
                    <span className="w-grow ex-payment-text">
                      <span className="w-strong">{nameOf(payment.from)}</span>
                      <span className="w-muted ex-pays">
                        {" pays "}
                        <ArrowRight size={12} aria-hidden="true" />
                      </span>{" "}
                      <span className="w-strong">{nameOf(payment.to)}</span>
                    </span>
                    <span className="w-num w-strong">{money(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function splitLabel(
  expense: ExpenseEntry,
  activeIds: string[],
  nameOf: (id: string) => string,
): string {
  if (!expense.splitBetween)
    return activeIds.length === 0 ? "nobody to split with" : "split between everyone";
  const ids = expense.splitBetween;
  if (ids.length === 1) return `for ${nameOf(ids[0] ?? "")} only`;
  if (ids.length <= 3) return `split between ${ids.map(nameOf).join(", ")}`;
  return `split between ${ids.length} people`;
}

function ExpenseForm({
  expense,
  people,
  digits,
  currency,
  defaultPayer,
  onSave,
  onCancel,
  onDelete,
}: {
  expense: ExpenseEntry | null;
  people: ExpensePerson[];
  digits: number;
  currency: string;
  defaultPayer: string;
  onSave: (values: FormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState(expense?.title ?? "");
  const [amount, setAmount] = useState(expense ? minorToInput(expense.amountMinor, digits) : "");
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? defaultPayer);
  // null = everyone; otherwise the ids that are ticked
  const [subset, setSubset] = useState<string[] | null>(expense?.splitBetween ?? null);
  const [error, setError] = useState("");

  const active = people.filter((person) => !person.removed);
  const activeIds = active.map((person) => person.id);
  // People an existing expense still refers to stay selectable even if they were removed.
  const referenced = [expense?.paidBy ?? "", ...(expense?.splitBetween ?? [])].filter(
    (id) => id && !activeIds.includes(id),
  );
  const extra = [...new Set(referenced)].map(
    (id) => people.find((person) => person.id === id) ?? { id, name: "Someone" },
  );
  const payers = [...active, ...extra.filter((person) => person.id === expense?.paidBy)];
  const sharers = [
    ...active,
    ...extra.filter((person) => expense?.splitBetween?.includes(person.id)),
  ];
  const ticked = (id: string) => (subset ? subset.includes(id) : activeIds.includes(id));
  const tickedCount = sharers.filter((person) => ticked(person.id)).length;

  function toggle(id: string) {
    const current = subset ?? activeIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    const everyone = next.length === activeIds.length && activeIds.every((x) => next.includes(x));
    setSubset(everyone ? null : next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim().slice(0, 80);
    const amountMinor = parseAmountInput(amount, digits);
    if (!cleanTitle) return setError("Say what it was for.");
    if (amountMinor === null) return setError("Enter an amount above zero.");
    if (!paidBy || !payers.some((person) => person.id === paidBy))
      return setError("Choose who paid.");
    if (subset && subset.length === 0)
      return setError("Choose at least one person to split between.");
    onSave({ title: cleanTitle, amountMinor, paidBy, splitBetween: subset });
  }

  if (active.length === 0 && !expense) {
    return (
      <div className="ex-form">
        <div className="w-small w-muted">Add at least one person under Balances first.</div>
        <div className="ex-form-actions">
          <button type="button" className="w-btn" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="ex-form"
      onSubmit={submit}
      aria-label={expense ? `Edit ${expense.title}` : "New expense"}
    >
      <div className="ex-form-row">
        <input
          className="w-input ex-form-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What was it for?"
          aria-label="Title"
          maxLength={80}
          // biome-ignore lint/a11y/noAutofocus: the form opens on the member's own request
          autoFocus
        />
        <div className="ex-amount">
          <input
            className="w-input w-num"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label={`Amount in ${currency}`}
            maxLength={16}
          />
          <span className="ex-currency w-small w-muted" aria-hidden="true">
            {currency}
          </span>
        </div>
      </div>
      <div className="ex-form-row">
        <label className="w-small w-muted ex-label" htmlFor={`${uid}-payer`}>
          Paid by
        </label>
        <select
          id={`${uid}-payer`}
          className="w-input ex-select"
          value={paidBy}
          onChange={(event) => setPaidBy(event.target.value)}
        >
          {!payers.some((person) => person.id === paidBy) && <option value="">Choose</option>}
          {payers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="ex-split">
        <legend className="w-small w-muted">
          Split equally between {subset ? `${tickedCount} of ${sharers.length}` : "everyone"}
        </legend>
        <div className="ex-split-chips">
          {sharers.map((person) => (
            <button
              key={person.id}
              type="button"
              className={`ex-toggle${ticked(person.id) ? " is-on" : ""}`}
              aria-pressed={ticked(person.id)}
              onClick={() => toggle(person.id)}
            >
              {ticked(person.id) && <Check size={12} aria-hidden="true" />}
              {person.name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="ex-error w-small" role="alert">
        {error}
      </div>
      <div className="ex-form-actions">
        {onDelete && (
          <button type="button" className="w-btn w-btn-ghost ex-delete" onClick={onDelete}>
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        )}
        <span className="w-grow" />
        <button type="button" className="w-btn w-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="w-btn w-btn-primary">
          {expense ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}
