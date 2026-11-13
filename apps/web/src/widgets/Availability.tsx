import type { MemberInfo, ToolState } from "@sofra/shared";
import type { AvailabilityConfig } from "@sofra/widgets";
import { Check, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Avatar, asRecord, entriesWithPrefix, InlineEdit, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./availability.css";

type Slot = { id: string; label: string; createdAt: number };
type Answer = "yes" | "maybe" | "no";
type Person = { id: string; name: string; color?: string; present: boolean };

const MAX_SLOTS = 40;
const ANSWER_WORD: Record<Answer, string> = { yes: "yes", maybe: "maybe", no: "no" };

function readSlots(config: AvailabilityConfig, data: ToolState): Slot[] {
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (const slot of config.slots ?? []) {
    seen.add(slot.id);
    if (data[`removed:${slot.id}`] === true) continue;
    const override = asRecord(data[`slot:${slot.id}`]);
    const label =
      typeof override?.label === "string" && override.label.trim()
        ? override.label.trim()
        : slot.label;
    out.push({ id: slot.id, label, createdAt: 0 });
  }
  const added: Slot[] = [];
  for (const [id, value] of entriesWithPrefix(data, "slot:")) {
    if (seen.has(id) || id.includes(":") || data[`removed:${id}`] === true) continue;
    const record = asRecord(value);
    if (typeof record?.label !== "string" || !record.label.trim()) continue;
    const createdAt =
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;
    added.push({ id, label: record.label.trim(), createdAt });
  }
  added.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return out.concat(added).slice(0, MAX_SLOTS);
}

/** memberId -> slotId -> answer, only for slots that are shown */
function readAnswers(data: ToolState, slotIds: Set<string>): Map<string, Map<string, Answer>> {
  const out = new Map<string, Map<string, Answer>>();
  for (const [rest, value] of entriesWithPrefix(data, "answer:")) {
    if (value !== "yes" && value !== "maybe" && value !== "no") continue;
    const cut = rest.lastIndexOf(":");
    if (cut <= 0) continue;
    const memberId = rest.slice(0, cut);
    const slotId = rest.slice(cut + 1);
    if (!slotIds.has(slotId)) continue;
    let row = out.get(memberId);
    if (!row) {
      row = new Map();
      out.set(memberId, row);
    }
    row.set(slotId, value);
  }
  return out;
}

function readPeople(
  data: ToolState,
  me: MemberInfo,
  members: MemberInfo[],
  answers: Map<string, Map<string, Answer>>,
): Person[] {
  const others = new Map<string, Person>();
  for (const member of members) {
    if (member.id !== me.id) others.set(member.id, { ...member, present: true });
  }
  for (const memberId of answers.keys()) {
    if (memberId === me.id || others.has(memberId)) continue;
    const stored = asRecord(data[`who:${memberId}`]);
    others.set(memberId, {
      id: memberId,
      name: typeof stored?.name === "string" && stored.name.trim() ? stored.name : "Someone",
      color: typeof stored?.color === "string" ? stored.color : undefined,
      present: false,
    });
  }
  const sorted = Array.from(others.values()).sort(
    (a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : 1),
  );
  return [{ ...me, present: true }, ...sorted];
}

function AnswerMark({ answer }: { answer: Answer | undefined }) {
  if (answer === "yes") return <Check size={16} strokeWidth={2.5} aria-hidden="true" />;
  if (answer === "no") return <X size={15} strokeWidth={2.5} aria-hidden="true" />;
  if (answer === "maybe") return <span aria-hidden="true">?</span>;
  return null;
}

export function Availability({
  config,
  data,
  set,
  del,
  me,
  members,
}: WidgetProps<AvailabilityConfig>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const allowMaybe = config.allowMaybe !== false;
  const slots = readSlots(config, data);
  const answers = readAnswers(data, new Set(slots.map((s) => s.id)));
  const people = readPeople(data, me, members, answers);

  const totals = slots.map((slot) => {
    const total = { yes: 0, maybe: 0, no: 0 };
    for (const row of answers.values()) {
      const answer = row.get(slot.id);
      if (answer) total[answer] += 1;
    }
    return total;
  });
  let bestYes = 0;
  let bestNo = 0;
  for (const total of totals) {
    if (total.yes > bestYes || (total.yes === bestYes && total.yes > 0 && total.no < bestNo)) {
      bestYes = total.yes;
      bestNo = total.no;
    }
  }
  const isBest = totals.map((total) => bestYes > 0 && total.yes === bestYes && total.no === bestNo);
  const bestLabels = slots.filter((_, index) => isBest[index]).map((slot) => slot.label);
  const answered = people.filter((person) => person.present && answers.has(person.id)).length;
  const presentCount = people.filter((person) => person.present).length;

  function cycle(slot: Slot) {
    const current = answers.get(me.id)?.get(slot.id);
    const order: (Answer | undefined)[] = allowMaybe
      ? [undefined, "yes", "maybe", "no"]
      : [undefined, "yes", "no"];
    const at = order.indexOf(current);
    const next = order[(at + 1) % order.length];
    if (next) set(`answer:${me.id}:${slot.id}`, next);
    else del(`answer:${me.id}:${slot.id}`);
    const stored = asRecord(data[`who:${me.id}`]);
    if (stored?.name !== me.name || stored?.color !== me.color) {
      set(`who:${me.id}`, { name: me.name, color: me.color });
    }
  }

  function addSlot() {
    const label = draft.trim().slice(0, 60);
    if (!label || slots.length >= MAX_SLOTS) return;
    set(`slot:${newKeyId()}`, { label, createdAt: Date.now(), by: me.id });
    setDraft("");
  }

  function rename(slot: Slot, label: string) {
    const stored = asRecord(data[`slot:${slot.id}`]);
    const createdAt =
      typeof stored?.createdAt === "number" ? stored.createdAt : slot.createdAt || Date.now();
    set(`slot:${slot.id}`, { label: label.slice(0, 60), createdAt, by: me.id });
  }

  return (
    <div className="w-root av-root">
      <div className="av-head">
        <div className="av-prompt">{config.prompt}</div>
        <div className="av-best w-small" aria-live="polite">
          {bestLabels.length > 0 ? (
            <>
              <Star size={13} aria-hidden="true" className="av-best-icon" />
              <span>
                <span className="w-muted">Best so far: </span>
                <span className="w-strong">{bestLabels.join(", ")}</span>
                <span className="w-muted">
                  {" "}
                  ({bestYes} of {answers.size} can make it)
                </span>
              </span>
            </>
          ) : (
            <span className="w-muted">
              Tap the cells in your row: yes{allowMaybe ? ", maybe" : ""}, no, then clear.
            </span>
          )}
        </div>
      </div>

      {slots.length === 0 ? (
        <div className="w-empty">
          {config.allowAdd
            ? "No times yet. Add the first one below."
            : "No times to choose from yet."}
        </div>
      ) : editing ? (
        <ul className="av-edit-list">
          {slots.map((slot) => (
            <li key={slot.id} className="av-edit-row">
              <InlineEdit
                value={slot.label}
                onCommit={(label) => rename(slot, label)}
                ariaLabel={`Rename time ${slot.label}`}
                maxLength={60}
                required
              />
              <button
                type="button"
                className="w-icon-btn"
                aria-label={`Remove time ${slot.label}`}
                onClick={() => set(`removed:${slot.id}`, true)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="av-scroll">
          <table className="av-table">
            <thead>
              <tr>
                <th className="av-corner" scope="col">
                  <span className="av-sr">Member</span>
                </th>
                {slots.map((slot, index) => (
                  <th
                    key={slot.id}
                    scope="col"
                    className={isBest[index] ? "av-slot is-best" : "av-slot"}
                    data-best={isBest[index] ? "true" : undefined}
                  >
                    <span className="av-slot-label">{slot.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const mine = person.id === me.id;
                const row = answers.get(person.id);
                return (
                  <tr key={person.id} className={mine ? "av-row is-me" : "av-row"}>
                    <th scope="row" className="av-name">
                      <span className="av-name-inner" title={person.name}>
                        <Avatar size={20} member={person} />
                        <span className={`av-name-text${person.present ? "" : " w-muted"}`}>
                          {mine ? "You" : person.name}
                        </span>
                      </span>
                    </th>
                    {slots.map((slot, index) => {
                      const answer = row?.get(slot.id);
                      const className = `av-cell is-${answer ?? "unset"}`;
                      return (
                        <td key={slot.id} className={isBest[index] ? "is-best" : undefined}>
                          {mine ? (
                            <button
                              type="button"
                              className={className}
                              aria-label={`${slot.label}: ${answer ? ANSWER_WORD[answer] : "no answer"}`}
                              onClick={() => cycle(slot)}
                            >
                              <AnswerMark answer={answer} />
                            </button>
                          ) : (
                            <span
                              className={className}
                              role="img"
                              aria-label={`${person.name}, ${slot.label}: ${answer ? ANSWER_WORD[answer] : "no answer"}`}
                            >
                              <AnswerMark answer={answer} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="av-name">
                  <span className="w-small w-muted">Can make it</span>
                </th>
                {slots.map((slot, index) => {
                  const total = totals[index] ?? { yes: 0, maybe: 0, no: 0 };
                  return (
                    <td
                      key={slot.id}
                      className={isBest[index] ? "av-total is-best" : "av-total"}
                      aria-label={`${slot.label}: ${total.yes} yes, ${total.maybe} maybe, ${total.no} no`}
                    >
                      <span className="w-num w-strong">{total.yes}</span>
                      {total.maybe > 0 ? (
                        <span className="w-num w-small w-muted"> +{total.maybe}?</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {config.allowAdd ? (
        <div className="w-row">
          <input
            className="w-input"
            value={draft}
            maxLength={60}
            placeholder="Add a time, e.g. Sun 22 Nov, lunch"
            aria-label="Add a time"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSlot();
              }
            }}
          />
          <button type="button" className="w-btn" onClick={addSlot} disabled={!draft.trim()}>
            <Plus size={15} aria-hidden="true" /> Add
          </button>
        </div>
      ) : null}

      <div className="w-row-between av-foot">
        <span className="w-small w-muted">
          {answered} of {presentCount} here {answered === 1 ? "has" : "have"} answered
        </span>
        {config.allowAdd && slots.length > 0 ? (
          <button
            type="button"
            className="w-btn w-btn-ghost w-small av-edit-btn"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? (
              "Done"
            ) : (
              <>
                <Pencil size={13} aria-hidden="true" /> Edit times
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
