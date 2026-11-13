import type { ToolState } from "@sofra/shared";
import type { PollConfig } from "@sofra/widgets";
import { Check, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, asRecord, entriesWithPrefix, InlineEdit, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./poll.css";

type Option = { id: string; label: string; createdAt: number };
type Vote = { memberId: string; name: string; color?: string; choices: string[] };

const MAX_OPTIONS = 40;
const MAX_FACES = 4;

function readOptions(config: PollConfig, data: ToolState): Option[] {
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const option of config.options ?? []) {
    seen.add(option.id);
    if (data[`removed:${option.id}`] === true) continue;
    const override = asRecord(data[`option:${option.id}`]);
    const label =
      typeof override?.label === "string" && override.label.trim()
        ? override.label.trim()
        : option.label;
    out.push({ id: option.id, label, createdAt: 0 });
  }
  const added: Option[] = [];
  for (const [id, value] of entriesWithPrefix(data, "option:")) {
    if (seen.has(id) || data[`removed:${id}`] === true) continue;
    const record = asRecord(value);
    if (typeof record?.label !== "string" || !record.label.trim()) continue;
    const createdAt =
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;
    added.push({ id, label: record.label.trim(), createdAt });
  }
  added.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return out.concat(added).slice(0, MAX_OPTIONS);
}

function readVotes(data: ToolState, valid: Set<string>, multiple: boolean): Vote[] {
  const out: Vote[] = [];
  for (const [memberId, value] of entriesWithPrefix(data, "vote:")) {
    const record = asRecord(value);
    if (!record) continue;
    const raw = Array.isArray(record.choices)
      ? record.choices
      : typeof record.choices === "string"
        ? [record.choices]
        : [];
    let choices = Array.from(
      new Set(raw.filter((c): c is string => typeof c === "string" && valid.has(c))),
    );
    if (!multiple) choices = choices.slice(0, 1);
    if (choices.length === 0) continue;
    out.push({
      memberId,
      name: typeof record.name === "string" && record.name.trim() ? record.name : "Someone",
      color: typeof record.color === "string" ? record.color : undefined,
      choices,
    });
  }
  return out;
}

export function Poll({ config, data, set, del, me, members }: WidgetProps<PollConfig>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const multiple = config.multiple === true;
  const options = readOptions(config, data);
  const votes = readVotes(data, new Set(options.map((o) => o.id)), multiple);
  const mine = votes.find((vote) => vote.memberId === me.id);
  const myChoices = mine?.choices ?? [];
  const showResults = config.showResults !== "afterVote" || myChoices.length > 0;

  const counts = new Map<string, number>();
  for (const vote of votes)
    for (const choice of vote.choices) counts.set(choice, (counts.get(choice) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());

  const present = members.some((m) => m.id === me.id) ? members : [me, ...members];
  const presentVoted = present.filter((m) => votes.some((v) => v.memberId === m.id)).length;
  const awayVoted = votes.length - presentVoted;

  function vote(optionId: string) {
    const has = myChoices.includes(optionId);
    const next = multiple
      ? has
        ? myChoices.filter((c) => c !== optionId)
        : [...myChoices, optionId]
      : has
        ? []
        : [optionId];
    if (next.length === 0) del(`vote:${me.id}`);
    else set(`vote:${me.id}`, { name: me.name, color: me.color, choices: next, at: Date.now() });
  }

  function addOption() {
    const label = draft.trim().slice(0, 120);
    if (!label || options.length >= MAX_OPTIONS) return;
    const existing = options.find((o) => o.label.toLowerCase() === label.toLowerCase());
    if (!existing) set(`option:${newKeyId()}`, { label, createdAt: Date.now(), by: me.id });
    setDraft("");
  }

  function rename(option: Option, label: string) {
    const stored = asRecord(data[`option:${option.id}`]);
    const createdAt =
      typeof stored?.createdAt === "number" ? stored.createdAt : option.createdAt || Date.now();
    set(`option:${option.id}`, { label: label.slice(0, 120), createdAt, by: me.id });
  }

  return (
    <div className="w-root poll-root">
      <div className="poll-head">
        <div className="poll-question">{config.question}</div>
        <div className="w-row poll-meta">
          <span className="w-small w-muted">{multiple ? "Pick any that apply" : "Pick one"}</span>
          {config.anonymous ? (
            <span className="w-chip">
              <EyeOff size={12} aria-hidden="true" /> Anonymous
            </span>
          ) : null}
        </div>
      </div>

      {options.length === 0 ? (
        <div className="w-empty">
          {config.allowAdd
            ? "No options yet. Add the first one below."
            : "This poll has no options yet."}
        </div>
      ) : editing ? (
        <ul className="poll-list">
          {options.map((option) => (
            <li key={option.id} className="poll-edit-row">
              <InlineEdit
                value={option.label}
                onCommit={(label) => rename(option, label)}
                ariaLabel={`Rename option ${option.label}`}
                maxLength={120}
                required
              />
              <button
                type="button"
                className="w-icon-btn"
                aria-label={`Remove option ${option.label}`}
                onClick={() => set(`removed:${option.id}`, true)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          className="poll-list"
          role={multiple ? "group" : "radiogroup"}
          aria-label={config.question}
        >
          {options.map((option) => {
            const count = counts.get(option.id) ?? 0;
            const percent = votes.length > 0 ? Math.round((count / votes.length) * 100) : 0;
            const chosen = myChoices.includes(option.id);
            const leading = showResults && count > 0 && count === top;
            const voters = votes.filter((v) => v.choices.includes(option.id));
            const className = `poll-option${chosen ? " is-mine" : ""}${leading ? " is-leading" : ""}`;
            return (
              <li key={option.id}>
                {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is radio or checkbox, both support aria-checked */}
                <button
                  type="button"
                  className={className}
                  role={multiple ? "checkbox" : "radio"}
                  aria-checked={chosen}
                  data-leading={leading ? "true" : undefined}
                  onClick={() => vote(option.id)}
                >
                  <span
                    className="poll-fill"
                    style={{ width: showResults ? `${percent}%` : "0%" }}
                    aria-hidden="true"
                  />
                  <span className={`poll-mark${multiple ? " is-square" : ""}`} aria-hidden="true">
                    {chosen ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  <span className="poll-label">{option.label}</span>
                  {showResults ? (
                    <span className="poll-result">
                      {!config.anonymous && voters.length > 0 ? (
                        <span className="poll-faces">
                          {voters.slice(0, MAX_FACES).map((voter) => (
                            <Avatar
                              key={voter.memberId}
                              size={20}
                              member={{
                                name:
                                  members.find((m) => m.id === voter.memberId)?.name ?? voter.name,
                                color:
                                  members.find((m) => m.id === voter.memberId)?.color ??
                                  voter.color,
                              }}
                            />
                          ))}
                          {voters.length > MAX_FACES ? (
                            <span className="poll-more w-small">+{voters.length - MAX_FACES}</span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="poll-count w-num">
                        <span className="w-strong">{count}</span>
                        <span className="w-muted w-small">{percent}%</span>
                      </span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {config.allowAdd ? (
        <div className="w-row">
          <input
            className="w-input"
            value={draft}
            maxLength={120}
            placeholder="Add an option"
            aria-label="Add an option"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addOption();
              }
            }}
          />
          <button type="button" className="w-btn" onClick={addOption} disabled={!draft.trim()}>
            <Plus size={15} aria-hidden="true" /> Add
          </button>
        </div>
      ) : null}

      <div className="w-row-between poll-foot">
        <span className="w-small w-muted" aria-live="polite">
          {!showResults
            ? "Results appear after you vote"
            : `${presentVoted} of ${present.length} here ${presentVoted === 1 ? "has" : "have"} voted${
                awayVoted > 0 ? `, ${awayVoted} more earlier` : ""
              }`}
        </span>
        <span className="w-row poll-actions">
          {myChoices.length > 0 ? (
            <button
              type="button"
              className="w-btn w-btn-ghost w-small"
              onClick={() => del(`vote:${me.id}`)}
            >
              Clear my vote
            </button>
          ) : null}
          {config.allowAdd && options.length > 0 ? (
            <button
              type="button"
              className="w-btn w-btn-ghost w-small"
              aria-pressed={editing}
              onClick={() => setEditing(!editing)}
            >
              {editing ? (
                "Done"
              ) : (
                <>
                  <Pencil size={13} aria-hidden="true" /> Edit options
                </>
              )}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
