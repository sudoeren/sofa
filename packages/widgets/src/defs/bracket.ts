import type { JsonValue, ToolState } from "@sofa/shared";
import { z } from "zod";
import type { WidgetDef } from "../types";

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "id must be 1-40 characters of letters, digits, _ or -");

const configSchema = z
  .object({
    title: z.string().trim().max(80).default(""),
    /** in seed order: the first entry is the top seed */
    participants: z
      .array(z.object({ id: idSchema, name: z.string().trim().min(1).max(40) }))
      .min(2)
      .max(32),
    /** label only, e.g. 3 for "best of 3" */
    bestOf: z.number().int().min(1).max(15).optional(),
    thirdPlace: z.boolean().default(false),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const [index, participant] of config.participants.entries()) {
      if (seen.has(participant.id)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate participant id",
          path: ["participants", index, "id"],
        });
      }
      seen.add(participant.id);
    }
  });

export type BracketConfig = z.infer<typeof configSchema>;

/* ---------------------------------------------------------------- generation */

/** Smallest power of two that holds `count` participants (at least 2). */
export function bracketSize(count: number): number {
  let size = 2;
  while (size < count) size *= 2;
  return size;
}

/**
 * Standard seeding: seed numbers (1-based) in first-round slot order, so that seed 1 and
 * seed 2 can only meet in the final. seedOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function seedOrder(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) {
    const total = seeds.length * 2;
    seeds = seeds.flatMap((seed) => [seed, total + 1 - seed]);
  }
  return seeds;
}

/**
 * First-round pairings for participants given in seed order. Null is an empty slot: its
 * opponent has a bye. Because seeds beyond the participant count are the empty ones, byes
 * always go to the top seeds, and no pairing is empty on both sides.
 */
export function firstRound(participantIds: string[]): [string | null, string | null][] {
  const ids = participantIds.slice(0, 32);
  const size = bracketSize(ids.length);
  const order = seedOrder(size);
  const out: [string | null, string | null][] = [];
  for (let i = 0; i < size; i += 2) {
    out.push([ids[(order[i] ?? 0) - 1] ?? null, ids[(order[i + 1] ?? 0) - 1] ?? null]);
  }
  return out;
}

/* ---------------------------------------------------------------- results */

export type Side = "a" | "b";

/** The value written to "score:<matchId>". */
export type StoredResult = {
  /** participant ids of the matchup the result belongs to */
  a: string;
  b: string;
  scoreA: number | null;
  scoreB: number | null;
  winner: Side | null;
};

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanScore(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : null;
}

export function parseResult(value: unknown): StoredResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.a !== "string" || typeof value.b !== "string" || !value.a || !value.b)
    return null;
  return {
    a: value.a,
    b: value.b,
    scoreA: cleanScore(value.scoreA),
    scoreB: cleanScore(value.scoreB),
    winner: value.winner === "a" || value.winner === "b" ? value.winner : null,
  };
}

/** The tapped winner, or else the side with the higher score when both scores are in. */
export function winnerSide(
  result: Pick<StoredResult, "scoreA" | "scoreB" | "winner">,
): Side | null {
  if (result.winner) return result.winner;
  if (result.scoreA === null || result.scoreB === null || result.scoreA === result.scoreB)
    return null;
  return result.scoreA > result.scoreB ? "a" : "b";
}

export type BracketMatch = {
  /** "r<round>m<number>", both 1-based, or "third" */
  id: string;
  round: number;
  index: number;
  /** participant id, or null while unknown (or for the empty side of a bye) */
  a: string | null;
  b: string | null;
  /** first-round pairing with one empty side: not played, the present side advances */
  bye: boolean;
  /** both sides known and it is a real match */
  ready: boolean;
  scoreA: number | null;
  scoreB: number | null;
  winner: string | null;
  loser: string | null;
};

export type BracketParticipant = { id: string; name: string; seed: number };

export type BracketView = {
  participants: BracketParticipant[];
  size: number;
  /** rounds[0] is the first round; the last round holds the final */
  rounds: BracketMatch[][];
  third: BracketMatch | null;
  champion: string | null;
};

function applyResult(match: BracketMatch, data: ToolState): void {
  if (!match.a || !match.b) return;
  const stored = parseResult(data[`score:${match.id}`]);
  // A result recorded for another pairing (an earlier result changed since) does not count.
  if (!stored || stored.a !== match.a || stored.b !== match.b) return;
  match.scoreA = stored.scoreA;
  match.scoreB = stored.scoreB;
  const side = winnerSide(stored);
  if (side) {
    match.winner = side === "a" ? match.a : match.b;
    match.loser = side === "a" ? match.b : match.a;
  }
}

function emptyMatch(
  id: string,
  round: number,
  index: number,
  a: string | null,
  b: string | null,
): BracketMatch {
  return {
    id,
    round,
    index,
    a,
    b,
    bye: false,
    ready: a !== null && b !== null,
    scoreA: null,
    scoreB: null,
    winner: null,
    loser: null,
  };
}

/**
 * Build the whole bracket from the participants (in seed order) and the stored results.
 * Nothing derived is stored: who meets whom in later rounds is computed here on every
 * call, so everyone converges on the same bracket whatever order the results arrived in.
 */
export function resolveBracket(
  participants: { id: string; name: string }[],
  data: ToolState,
  thirdPlace = false,
): BracketView {
  const seen = new Set<string>();
  const list: BracketParticipant[] = [];
  for (const participant of participants) {
    if (
      list.length >= 32 ||
      !participant ||
      typeof participant.id !== "string" ||
      seen.has(participant.id)
    )
      continue;
    seen.add(participant.id);
    const stored = data[`name:${participant.id}`];
    const renamed = typeof stored === "string" ? stored.trim().slice(0, 40) : "";
    list.push({ id: participant.id, name: renamed || participant.name, seed: list.length + 1 });
  }
  const size = bracketSize(list.length);
  const rounds: BracketMatch[][] = [];
  if (list.length < 2)
    return { participants: list, size, rounds, third: null, champion: list[0]?.id ?? null };

  const first = firstRound(list.map((p) => p.id)).map(([a, b], index) => {
    const match = emptyMatch(`r1m${index + 1}`, 1, index, a, b);
    if (a === null || b === null) {
      match.bye = true;
      match.ready = false;
      match.winner = a ?? b;
    } else {
      applyResult(match, data);
    }
    return match;
  });
  rounds.push(first);
  while ((rounds[rounds.length - 1]?.length ?? 0) > 1) {
    const previous = rounds[rounds.length - 1] ?? [];
    const round = rounds.length + 1;
    const next: BracketMatch[] = [];
    for (let i = 0; i < previous.length; i += 2) {
      const match = emptyMatch(
        `r${round}m${i / 2 + 1}`,
        round,
        i / 2,
        previous[i]?.winner ?? null,
        previous[i + 1]?.winner ?? null,
      );
      applyResult(match, data);
      next.push(match);
    }
    rounds.push(next);
  }

  let third: BracketMatch | null = null;
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : undefined;
  if (thirdPlace && semis && semis.length === 2 && semis.every((m) => !m.bye)) {
    third = emptyMatch("third", rounds.length, 1, semis[0]?.loser ?? null, semis[1]?.loser ?? null);
    applyResult(third, data);
  }
  const final = rounds[rounds.length - 1]?.[0];
  return { participants: list, size, rounds, third, champion: final?.winner ?? null };
}

/** "Final", "Semifinals", "Quarterfinals", "Round of 16"... */
export function roundName(round: number, totalRounds: number): string {
  const matches = 2 ** (totalRounds - round);
  if (matches <= 1) return "Final";
  if (matches === 2) return "Semifinals";
  if (matches === 4) return "Quarterfinals";
  return `Round of ${matches * 2}`;
}

/* ---------------------------------------------------------------- definition */

export const bracket: WidgetDef<BracketConfig> = {
  type: "bracket",
  title: "Bracket",
  description: "A knockout tournament: enter results and winners move on.",
  guide: [
    'Use for single-elimination tournaments and knockout votes (games, sports, "best snack" showdowns).',
    "config.title: optional heading. config.participants: [{id, name}], 2 to 32, in seed order (first = top seed). Any count works; top seeds get byes in the first round.",
    'config.bestOf: optional odd number shown as a label ("Best of 3"). config.thirdPlace: true adds a match for third place between the semifinal losers (default false).',
    'Match ids are "r<round>m<number>", both 1-based, numbered top to bottom ("r1m1"; the final of 8 players is "r3m1"); the third place match is "third". First-round slots follow standard seeding (8 players: 1-8, 4-5, 2-7, 3-6).',
    "State keys:",
    '"score:<matchId>" = {a, b, scoreA, scoreB, winner}: a and b are the participant ids of the two sides when the result was entered; scoreA/scoreB are whole numbers or null; winner is "a", "b" or null (null with two different scores means the higher score wins).',
    "Later matchups are never stored: they are derived from the results on every render. A stored result whose a/b do not match the current matchup is ignored, so changing an early result resets the matches that depended on it.",
    '"name:<participantId>" = string: a participant renamed by a member.',
  ].join("\n"),
  configSchema,
  starter: {
    title: "Office table tennis cup",
    description: "Tap the winner of each match, or type the score. Winners move on by themselves.",
    config: {
      title: "Table tennis cup",
      bestOf: 3,
      thirdPlace: true,
      participants: [
        { id: "elif", name: "Elif" },
        { id: "can", name: "Can" },
        { id: "zeynep", name: "Zeynep" },
        { id: "emre", name: "Emre" },
        { id: "ayse", name: "Ayse" },
        { id: "burak", name: "Burak" },
        { id: "defne", name: "Defne" },
        { id: "kaan", name: "Kaan" },
      ],
    },
    initialState: {
      "score:r1m1": { a: "elif", b: "kaan", scoreA: 2, scoreB: 0, winner: "a" },
      "score:r1m2": { a: "emre", b: "ayse", scoreA: 1, scoreB: 2, winner: "b" },
      "score:r1m3": { a: "can", b: "defne", scoreA: 2, scoreB: 1, winner: "a" },
    },
  },
  keywords: [
    "bracket",
    "tournament",
    "knockout",
    "elimination",
    "playoff",
    "playoffs",
    "cup",
    "championship",
    "match",
    "matches",
    "final",
    "turnuva",
    "eleme",
    "fikstur",
    "mac",
    "kupa",
  ],
};
