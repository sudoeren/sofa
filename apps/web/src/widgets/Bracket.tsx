import type { BracketConfig } from "@sofra/widgets";
import { Pencil, Trophy } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type BracketMatch,
  type BracketParticipant,
  resolveBracket,
  roundName,
  type Side,
  type StoredResult,
} from "@sofra/widgets/defs/bracket";
import { InlineEdit } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./bracket.css";

export function Bracket({ config, data, set, del }: WidgetProps<BracketConfig>) {
  const participants = Array.isArray(config.participants) ? config.participants : [];
  const view = useMemo(
    () => resolveBracket(participants, data, config.thirdPlace === true),
    [participants, data, config.thirdPlace],
  );
  const [renaming, setRenaming] = useState(false);
  const [renameKey, setRenameKey] = useState(0);
  const byId = new Map(view.participants.map((p) => [p.id, p]));
  const totalRounds = view.rounds.length;
  const champion = view.champion ? byId.get(view.champion) : undefined;

  function write(match: BracketMatch, next: Pick<StoredResult, "scoreA" | "scoreB" | "winner">) {
    if (!match.a || !match.b) return;
    if (next.scoreA === null && next.scoreB === null && next.winner === null) {
      del(`score:${match.id}`);
      return;
    }
    set(`score:${match.id}`, { a: match.a, b: match.b, ...next });
  }

  function currentSide(match: BracketMatch): Side | null {
    return match.winner === null ? null : match.winner === match.a ? "a" : "b";
  }

  function pick(match: BracketMatch, side: Side) {
    if (!match.ready) return;
    if (currentSide(match) === side) {
      // Untapping: the scores would decide again on their own, so they go too.
      write(match, { scoreA: null, scoreB: null, winner: null });
      return;
    }
    write(match, { scoreA: match.scoreA, scoreB: match.scoreB, winner: side });
  }

  function score(match: BracketMatch, side: Side, value: number | null) {
    if (!match.ready) return;
    const scoreA = side === "a" ? value : match.scoreA;
    const scoreB = side === "b" ? value : match.scoreB;
    const decided = scoreA !== null && scoreB !== null && scoreA !== scoreB;
    write(match, {
      scoreA,
      scoreB,
      winner: decided ? (scoreA > scoreB ? "a" : "b") : currentSide(match),
    });
  }

  if (view.participants.length < 2) {
    return (
      <div className="w-root bk-root">
        <div className="w-empty w-small">A bracket needs at least two participants.</div>
      </div>
    );
  }

  const card = (match: BracketMatch, label: string) => (
    <MatchCard match={match} label={label} byId={byId} onPick={pick} onScore={score} />
  );

  return (
    <div className="w-root bk-root">
      <div className="bk-head">
        <div className="w-grow bk-head-text">
          {config.title ? <span className="bk-title">{config.title}</span> : null}
          <span className="w-chip">{view.participants.length} players</span>
          {typeof config.bestOf === "number" && (
            <span className="w-chip">Best of {config.bestOf}</span>
          )}
        </div>
        <button
          type="button"
          className={`w-btn w-btn-ghost bk-rename${renaming ? " is-on" : ""}`}
          aria-expanded={renaming}
          onClick={() => setRenaming(!renaming)}
        >
          <Pencil size={13} aria-hidden="true" />
          Names
        </button>
      </div>

      {renaming && (
        <ol className="bk-names">
          {view.participants.map((p) => (
            <li key={p.id}>
              <span className="bk-seed w-num">{p.seed}</span>
              <InlineEdit
                key={renameKey}
                value={p.name}
                onCommit={(name) =>
                  name ? set(`name:${p.id}`, name.slice(0, 40)) : setRenameKey(renameKey + 1)
                }
                ariaLabel={`Name of seed ${p.seed}`}
                maxLength={40}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="bk-scroll">
        <div className="bk-grid">
          {view.rounds.map((round, roundIndex) => {
            const name = roundName(roundIndex + 1, totalRounds);
            const previous = roundIndex > 0 ? view.rounds[roundIndex - 1] : undefined;
            return (
              <div
                key={name}
                className={`bk-round${roundIndex === totalRounds - 1 ? " is-final" : ""}`}
              >
                <div className="bk-round-name">{name}</div>
                <div className="bk-cells">
                  {round.map((match) => {
                    const fed =
                      previous !== undefined &&
                      (previous[match.index * 2]?.bye === false ||
                        previous[match.index * 2 + 1]?.bye === false);
                    return (
                      <div
                        key={match.id}
                        className={`bk-cell${match.bye ? " is-bye" : ""}${fed ? " is-fed" : ""}`}
                      >
                        {!match.bye &&
                          card(
                            match,
                            round.length === 1 ? name : `${name} match ${match.index + 1}`,
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="bk-round bk-champ-col">
            <div className="bk-round-name">Champion</div>
            <div className="bk-cells">
              <div className="bk-cell is-fed">
                <div className={`bk-champ${champion ? " is-set" : ""}`} aria-live="polite">
                  <Trophy size={20} aria-hidden="true" />
                  <span className="bk-champ-name">
                    {champion ? champion.name : "To be decided"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {view.third && (
        <div className="bk-third">
          <div className="bk-round-name">Third place</div>
          {card(view.third, "Third place")}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match,
  label,
  byId,
  onPick,
  onScore,
}: {
  match: BracketMatch;
  label: string;
  byId: Map<string, BracketParticipant>;
  onPick: (match: BracketMatch, side: Side) => void;
  onScore: (match: BracketMatch, side: Side, value: number | null) => void;
}) {
  const sides: Side[] = ["a", "b"];
  return (
    <fieldset className={`bk-match${match.ready ? "" : " is-waiting"}`} aria-label={label}>
      {sides.map((side) => {
        const id = side === "a" ? match.a : match.b;
        const participant = id ? byId.get(id) : undefined;
        const won = match.winner !== null && match.winner === id;
        const lost = match.winner !== null && !won;
        const value = side === "a" ? match.scoreA : match.scoreB;
        return (
          <div key={side} className={`bk-side${won ? " is-winner" : ""}${lost ? " is-loser" : ""}`}>
            {participant ? (
              <button
                type="button"
                className="bk-pick"
                disabled={!match.ready}
                aria-pressed={won}
                aria-label={`${participant.name} wins, ${label}`}
                title={
                  match.ready ? (won ? "Winner (tap to undo)" : "Tap to mark as winner") : undefined
                }
                onClick={() => onPick(match, side)}
              >
                <span className="bk-seed w-num" aria-hidden="true">
                  {participant.seed}
                </span>
                <span className="bk-name">{participant.name}</span>
              </button>
            ) : (
              <span className="bk-pick bk-tbd">
                <span className="bk-seed" aria-hidden="true" />
                <span className="bk-name">TBD</span>
              </span>
            )}
            <ScoreInput
              value={value}
              disabled={!match.ready}
              label={`Score of ${participant?.name ?? "TBD"}, ${label}`}
              onCommit={(next) => onScore(match, side, next)}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

function ScoreInput({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  label: string;
  onCommit: (value: number | null) => void;
}) {
  const text = value === null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(text);
  }, [text]);

  function commit() {
    const clean = draft.trim();
    if (clean === text) return setDraft(text);
    if (clean === "") return onCommit(null);
    if (!/^\d{1,3}$/.test(clean)) return setDraft(text);
    onCommit(Number(clean));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    else if (event.key === "Escape") {
      setDraft(text);
      focused.current = false;
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className="bk-score w-num"
      value={draft}
      disabled={disabled}
      inputMode="numeric"
      maxLength={3}
      placeholder="-"
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        focused.current = true;
        event.currentTarget.select();
      }}
      onBlur={() => {
        if (!focused.current) return;
        focused.current = false;
        commit();
      }}
      onKeyDown={onKeyDown}
    />
  );
}
