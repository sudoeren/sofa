import type { ToolState } from "@sofa/shared";
import type { ChecklistConfig } from "@sofa/widgets";
import { Check, Hand, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, asRecord, entriesWithPrefix, InlineEdit, MemberPick, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./checklist.css";

type Item = { id: string; text: string; section: string; createdAt: number };
type Done = { by: string; name: string; at: number };
type Claim = { id: string; name: string; color?: string };

const MAX_ITEMS = 300;

function cleanSection(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 60) : "";
}

function readItems(
  config: ChecklistConfig,
  data: ToolState,
): { items: Item[]; sections: string[] } {
  const items: Item[] = [];
  const sections: string[] = [];
  const seen = new Set<string>();
  const note = (section: string) => {
    if (section && !sections.includes(section)) sections.push(section);
  };
  for (const item of config.items ?? []) {
    seen.add(item.id);
    const section = cleanSection(item.section);
    note(section);
    if (data[`removed:${item.id}`] === true) continue;
    const override = asRecord(data[`item:${item.id}`]);
    const text =
      typeof override?.text === "string" && override.text.trim() ? override.text.trim() : item.text;
    items.push({ id: item.id, text, section, createdAt: 0 });
  }
  const added: Item[] = [];
  for (const [id, value] of entriesWithPrefix(data, "item:")) {
    if (seen.has(id) || data[`removed:${id}`] === true) continue;
    const record = asRecord(value);
    if (typeof record?.text !== "string" || !record.text.trim()) continue;
    const createdAt =
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;
    added.push({ id, text: record.text.trim(), section: cleanSection(record.section), createdAt });
  }
  added.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  for (const item of added) note(item.section);
  return { items: items.concat(added).slice(0, MAX_ITEMS), sections };
}

function readDone(value: unknown): Done | null {
  if (value === true) return { by: "", name: "", at: 0 };
  const record = asRecord(value);
  if (!record) return null;
  return {
    by: typeof record.by === "string" ? record.by : "",
    name: typeof record.name === "string" ? record.name : "",
    at: typeof record.at === "number" ? record.at : 0,
  };
}

function readClaim(value: unknown): Claim | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || !record.id) return null;
  return {
    id: record.id,
    name: typeof record.name === "string" && record.name.trim() ? record.name : "Someone",
    color: typeof record.color === "string" ? record.color : undefined,
  };
}

function AddItem({ section, onAdd }: { section: string; onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const label = section ? `Add an item to ${section}` : "Add an item";
  function submit() {
    const text = draft.trim().slice(0, 200);
    if (!text) return;
    onAdd(text);
    setDraft("");
  }
  return (
    <div className="cl-add">
      <Plus size={16} aria-hidden="true" className="cl-add-icon" />
      <input
        className="w-inline-edit"
        value={draft}
        maxLength={200}
        placeholder="Add an item"
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            setDraft("");
          }
        }}
      />
      {draft.trim() ? (
        <button type="button" className="w-btn cl-add-btn" onClick={submit}>
          Add
        </button>
      ) : null}
    </div>
  );
}

/** Wrapped text that turns into an input when activated. */
function ItemText({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (editing) holder.current?.querySelector("input")?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="cl-text"
        aria-label={`Edit item: ${text}`}
        title="Edit"
        onClick={() => setEditing(true)}
      >
        {text}
      </button>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only listens for focus leaving the input inside
    <span className="cl-text-edit" ref={holder} onBlur={() => setEditing(false)}>
      <InlineEdit value={text} onCommit={onCommit} ariaLabel="Item text" maxLength={200} required />
    </span>
  );
}

export function Checklist({ config, data, set, del, me, members }: WidgetProps<ChecklistConfig>) {
  const { items, sections } = readItems(config, data);
  const doneCount = items.filter((item) => readDone(data[`done:${item.id}`])).length;
  const allDone = items.length > 0 && doneCount === items.length;
  const present = members.some((m) => m.id === me.id) ? members : [me, ...members];

  function add(text: string, section: string) {
    if (items.length >= MAX_ITEMS) return;
    set(`item:${newKeyId()}`, {
      text,
      ...(section ? { section } : {}),
      createdAt: Date.now(),
      by: me.id,
    });
  }

  function rename(item: Item, text: string) {
    const stored = asRecord(data[`item:${item.id}`]);
    set(`item:${item.id}`, {
      text: text.slice(0, 200),
      ...(item.section ? { section: item.section } : {}),
      createdAt:
        typeof stored?.createdAt === "number" ? stored.createdAt : item.createdAt || Date.now(),
      by: typeof stored?.by === "string" ? stored.by : me.id,
    });
  }

  function assign(item: Item, next: { id: string; name: string } | null) {
    if (!next) return del(`claim:${item.id}`);
    const color = present.find((m) => m.id === next.id)?.color;
    set(`claim:${item.id}`, { id: next.id, name: next.name, ...(color ? { color } : {}) });
  }

  function renderItem(item: Item) {
    const done = readDone(data[`done:${item.id}`]);
    const claim = config.assignable ? readClaim(data[`claim:${item.id}`]) : null;
    const claimMember = claim ? present.find((m) => m.id === claim.id) : undefined;
    const claimName = claimMember?.name ?? claim?.name ?? "";
    const doneBy = done ? (present.find((m) => m.id === done.by)?.name ?? done.name) : "";
    return (
      <li key={item.id} className={`cl-item${done ? " is-done" : ""}`}>
        {/* biome-ignore lint/a11y/useSemanticElements: custom drawn box; a button with the checkbox role keeps keyboard and screen reader behavior */}
        <button
          type="button"
          role="checkbox"
          aria-checked={done !== null}
          aria-label={`Done: ${item.text}`}
          title={done ? (doneBy ? `Checked off by ${doneBy}` : "Done") : "Mark as done"}
          className="cl-check"
          onClick={() =>
            done
              ? del(`done:${item.id}`)
              : set(`done:${item.id}`, { by: me.id, name: me.name, at: Date.now() })
          }
        >
          {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
        </button>
        <ItemText text={item.text} onCommit={(text) => rename(item, text)} />
        {config.assignable ? (
          claim ? (
            <MemberPick
              className="cl-claim is-claimed"
              style={{ borderRadius: 999 }}
              value={{ id: claim.id, name: claimName }}
              members={present}
              onChange={(next) => assign(item, next)}
              ariaLabel={`Assigned to ${claimName}: ${item.text}`}
            >
              <Avatar
                size={20}
                member={{ name: claimName, color: claimMember?.color ?? claim.color }}
              />
              <span className="cl-claim-name">
                {claim.id === me.id ? "You" : claimName.split(/\s+/)[0]}
              </span>
            </MemberPick>
          ) : done ? null : (
            <button
              type="button"
              className="cl-claim"
              aria-label={`I'll do it: ${item.text}`}
              onClick={() => assign(item, { id: me.id, name: me.name })}
            >
              <Hand size={14} aria-hidden="true" />
              <span className="cl-claim-name">I'll do it</span>
            </button>
          )
        ) : null}
        <button
          type="button"
          className="w-icon-btn cl-remove"
          aria-label={`Remove item: ${item.text}`}
          onClick={() => set(`removed:${item.id}`, true)}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </li>
    );
  }

  const loose = items.filter((item) => !item.section);
  const showLoose = loose.length > 0 || sections.length === 0;

  return (
    <div className="w-root cl-root">
      {config.showProgress ? (
        <div className="cl-progress">
          <div
            className={`w-bar w-grow${allDone ? " is-complete" : ""}`}
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={doneCount}
          >
            <span style={{ width: items.length ? `${(doneCount / items.length) * 100}%` : "0%" }} />
          </div>
          <span className={`w-small w-num cl-progress-text${allDone ? " is-complete" : ""}`}>
            {items.length === 0 ? "Nothing to do yet" : `${doneCount} of ${items.length} done`}
          </span>
        </div>
      ) : null}

      {showLoose ? (
        <div className="cl-section">
          {loose.length > 0 ? <ul className="cl-list">{loose.map(renderItem)}</ul> : null}
          <AddItem section="" onAdd={(text) => add(text, "")} />
        </div>
      ) : null}

      {sections.map((section) => {
        const list = items.filter((item) => item.section === section);
        const sectionDone = list.filter((item) => readDone(data[`done:${item.id}`])).length;
        return (
          <section key={section} className="cl-section" aria-label={section}>
            <div className="cl-heading">
              <h4>{section}</h4>
              <span className="w-small w-muted w-num">
                {sectionDone}/{list.length}
              </span>
            </div>
            {list.length > 0 ? <ul className="cl-list">{list.map(renderItem)}</ul> : null}
            <AddItem section={section} onAdd={(text) => add(text, section)} />
          </section>
        );
      })}
    </div>
  );
}
