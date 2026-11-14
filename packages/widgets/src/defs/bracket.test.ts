import type { ToolState } from "@sofra/shared";
import { describe, expect, it } from "vitest";
import {
  type BracketView,
  bracket,
  bracketSize,
  firstRound,
  parseResult,
  resolveBracket,
  roundName,
  seedOrder,
  winnerSide,
} from "./bracket";

const schema = bracket.configSchema;
const players = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

/** Record a win for the given side of a match as the component would. */
function win(view: BracketView, data: ToolState, matchId: string, side: "a" | "b"): ToolState {
  const match = [...view.rounds.flat(), ...(view.third ? [view.third] : [])].find(
    (m) => m.id === matchId,
  );
  if (!match?.a || !match.b) throw new Error(`match ${matchId} is not ready`);
  return {
    ...data,
    [`score:${matchId}`]: { a: match.a, b: match.b, scoreA: null, scoreB: null, winner: side },
  };
}

/** Play every match, the better seed (lower number) always winning. */
function playAll(count: number, thirdPlace = false) {
  const list = players(count);
  const seed = (id: string | null) => Number(id?.slice(1));
  let data: ToolState = {};
  let played = 0;
  for (let guard = 0; guard < 100; guard++) {
    const view = resolveBracket(list, data, thirdPlace);
    const open = [...view.rounds.flat(), ...(view.third ? [view.third] : [])].find(
      (m) => m.ready && !m.winner,
    );
    if (!open) return { view, data, played };
    data = win(view, data, open.id, seed(open.a) < seed(open.b) ? "a" : "b");
    played++;
  }
  throw new Error("did not finish");
}

describe("bracket config", () => {
  it("accepts the starter and its initial state is live", () => {
    const parsed = schema.parse(bracket.starter.config);
    const view = resolveBracket(
      parsed.participants,
      bracket.starter.initialState ?? {},
      parsed.thirdPlace,
    );
    expect(view.rounds[0]?.map((m) => m.winner)).toEqual(["elif", "ayse", "can", null]);
    expect(view.rounds[1]?.[0]).toMatchObject({ a: "elif", b: "ayse", ready: true });
  });

  it("applies defaults", () => {
    expect(schema.parse({ participants: players(2) })).toEqual({
      title: "",
      participants: players(2),
      thirdPlace: false,
    });
  });

  it("rejects malformed input", () => {
    const bad = [
      {},
      { participants: [] },
      { participants: players(1) },
      { participants: players(33) },
      { participants: [...players(2), { id: "p1", name: "Again" }] },
      {
        participants: [
          { id: "a", name: "" },
          { id: "b", name: "B" },
        ],
      },
      { participants: ["a", "b"] },
      { participants: players(4), bestOf: 0 },
      { participants: players(4), bestOf: 2.5 },
      { participants: players(4), thirdPlace: "yes" },
      { participants: players(4), title: "x".repeat(81) },
    ];
    for (const input of bad)
      expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and keywords", () => {
    const lines = bracket.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    expect(bracket.keywords).toContain("turnuva");
  });
});

describe("seeding", () => {
  it("sizes the bracket", () => {
    expect([2, 3, 4, 5, 8, 9, 13, 16, 17, 32].map(bracketSize)).toEqual([
      2, 4, 4, 8, 8, 16, 16, 16, 32, 32,
    ]);
  });

  it("uses the standard seed order", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
    const order = seedOrder(32);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    for (let i = 0; i < 32; i += 2) expect((order[i] ?? 0) + (order[i + 1] ?? 0)).toBe(33);
  });

  it.each([2, 3, 5, 8, 13, 32])("pairs %i participants with byes for the top seeds", (count) => {
    const ids = players(count).map((p) => p.id);
    const pairs = firstRound(ids);
    const size = bracketSize(count);
    expect(pairs).toHaveLength(size / 2);
    // everyone appears exactly once
    expect(pairs.flat().filter(Boolean).sort()).toEqual([...ids].sort());
    // no pairing is empty on both sides
    expect(pairs.every(([a, b]) => a !== null || b !== null)).toBe(true);
    // the byes go to exactly the top (size - count) seeds
    const byes = pairs.filter(([a, b]) => a === null || b === null).map(([a, b]) => a ?? b);
    expect(byes.sort()).toEqual(ids.slice(0, size - count).sort());
  });

  it("lays out the known small cases", () => {
    expect(firstRound(["a", "b"])).toEqual([["a", "b"]]);
    expect(firstRound(["a", "b", "c"])).toEqual([
      ["a", null],
      ["b", "c"],
    ]);
    expect(firstRound(["1", "2", "3", "4", "5"])).toEqual([
      ["1", null],
      ["4", "5"],
      ["2", null],
      ["3", null],
    ]);
  });
});

describe("results", () => {
  it("parses stored results defensively", () => {
    expect(parseResult({ a: "x", b: "y", scoreA: 2, scoreB: 1, winner: "a" })).toEqual({
      a: "x",
      b: "y",
      scoreA: 2,
      scoreB: 1,
      winner: "a",
    });
    expect(parseResult({ a: "x", b: "y", scoreA: -1, scoreB: 2.5, winner: "x" })).toEqual({
      a: "x",
      b: "y",
      scoreA: null,
      scoreB: null,
      winner: null,
    });
    for (const bad of [null, "a", 3, [], { a: "x" }, { a: 1, b: 2 }, { a: "", b: "y" }]) {
      expect(parseResult(bad)).toBeNull();
    }
  });

  it("decides the winner from a tap or from the scores", () => {
    expect(winnerSide({ scoreA: 3, scoreB: 1, winner: null })).toBe("a");
    expect(winnerSide({ scoreA: 1, scoreB: 3, winner: null })).toBe("b");
    expect(winnerSide({ scoreA: 2, scoreB: 2, winner: null })).toBeNull();
    expect(winnerSide({ scoreA: 2, scoreB: null, winner: null })).toBeNull();
    expect(winnerSide({ scoreA: 0, scoreB: 3, winner: "a" })).toBe("a");
  });
});

describe("resolveBracket", () => {
  it.each([
    [2, 1, 1],
    [3, 2, 2],
    [5, 3, 4],
    [8, 3, 7],
    [13, 4, 12],
    [32, 5, 31],
  ])("%i participants: %i rounds, %i matches played, top seed wins", (count, rounds, matches) => {
    const { view, played } = playAll(count);
    expect(view.rounds).toHaveLength(rounds);
    expect(view.rounds.map((r) => r.length)).toEqual(
      Array.from({ length: rounds }, (_, i) => 2 ** (rounds - 1 - i)),
    );
    expect(played).toBe(matches);
    expect(view.champion).toBe("p1");
    // seeds 1 and 2 meet in the final
    const final = view.rounds[rounds - 1]?.[0];
    expect([final?.a, final?.b].sort()).toEqual(["p1", "p2"]);
    expect(view.rounds.flat().filter((m) => m.bye)).toHaveLength(view.size - count);
  });

  it("advances byes without a result", () => {
    const view = resolveBracket(players(5), {});
    expect(view.rounds[0]?.map((m) => [m.id, m.bye, m.ready, m.winner])).toEqual([
      ["r1m1", true, false, "p1"],
      ["r1m2", false, true, null],
      ["r1m3", true, false, "p2"],
      ["r1m4", true, false, "p3"],
    ]);
    expect(view.rounds[1]?.map((m) => [m.id, m.a, m.b, m.ready])).toEqual([
      ["r2m1", "p1", null, false],
      ["r2m2", "p2", "p3", true],
    ]);
    expect(view.champion).toBeNull();
  });

  it("reads scores and ties", () => {
    const list = players(4);
    let view = resolveBracket(list, {
      "score:r1m1": { a: "p1", b: "p4", scoreA: 1, scoreB: 3, winner: null },
    });
    expect(view.rounds[0]?.[0]).toMatchObject({ scoreA: 1, scoreB: 3, winner: "p4", loser: "p1" });
    expect(view.rounds[1]?.[0]?.a).toBe("p4");
    view = resolveBracket(list, {
      "score:r1m1": { a: "p1", b: "p4", scoreA: 2, scoreB: 2, winner: null },
    });
    expect(view.rounds[0]?.[0]).toMatchObject({ scoreA: 2, scoreB: 2, winner: null });
    expect(view.rounds[1]?.[0]?.a).toBeNull();
  });

  it("drops later results when an earlier result changes", () => {
    const list = players(8);
    const { data } = playAll(8);
    expect(resolveBracket(list, data).champion).toBe("p1");
    // p8 beats p1 in the first match after all
    const changed: ToolState = {
      ...data,
      "score:r1m1": { a: "p1", b: "p8", scoreA: null, scoreB: null, winner: "b" },
    };
    const view = resolveBracket(list, changed);
    const semi = view.rounds[1]?.[0];
    expect(semi).toMatchObject({ a: "p8", b: "p4", winner: null, ready: true });
    const final = view.rounds[2]?.[0];
    expect(final).toMatchObject({ a: null, b: "p2", winner: null, ready: false });
    expect(view.champion).toBeNull();
    // the other half of the bracket is untouched
    expect(view.rounds[1]?.[1]).toMatchObject({ a: "p2", b: "p3", winner: "p2" });
    // going back restores what was there, the same for everyone
    expect(resolveBracket(list, data).champion).toBe("p1");
  });

  it("gives the same bracket whatever order the results were written in", () => {
    const { data } = playAll(13, false);
    const reversed = Object.fromEntries(Object.entries(data).reverse());
    expect(resolveBracket(players(13), reversed)).toEqual(resolveBracket(players(13), data));
  });

  it("ignores results for matchups that do not exist", () => {
    const view = resolveBracket(players(4), {
      "score:r1m1": { a: "p4", b: "p1", scoreA: 3, scoreB: 0, winner: "a" },
      "score:r2m1": { a: "p1", b: "p2", scoreA: 3, scoreB: 0, winner: "a" },
      "score:r9m9": { a: "p1", b: "p2", winner: "a" },
      "score:r1m2": "garbage",
      "score:": null,
    });
    expect(view.rounds.flat().every((m) => m.winner === null)).toBe(true);
    expect(view.champion).toBeNull();
  });

  it("adds a third place match between the semifinal losers", () => {
    const { view, played } = playAll(8, true);
    expect(played).toBe(8);
    expect(view.third).toMatchObject({ id: "third", a: "p4", b: "p3", winner: "p3" });
    expect(resolveBracket(players(8), {}, true).third).toMatchObject({
      a: null,
      b: null,
      ready: false,
    });
    // not enough real semifinals
    expect(resolveBracket(players(2), {}, true).third).toBeNull();
    expect(resolveBracket(players(3), {}, true).third).toBeNull();
    expect(resolveBracket(players(4), {}, true).third).not.toBeNull();
    expect(resolveBracket(players(8), {}, false).third).toBeNull();
  });

  it("applies renames and tolerates odd participant lists", () => {
    const view = resolveBracket(players(2), { "name:p1": "  The Champ ", "name:p2": 5 });
    expect(view.participants).toEqual([
      { id: "p1", name: "The Champ", seed: 1 },
      { id: "p2", name: "Player 2", seed: 2 },
    ]);
    expect(resolveBracket([], {}).rounds).toEqual([]);
    expect(resolveBracket(players(1), {}).rounds).toEqual([]);
    expect(resolveBracket([...players(3), ...players(3)], {}).participants).toHaveLength(3);
    expect(resolveBracket(players(40), {}).participants).toHaveLength(32);
  });

  it("names rounds", () => {
    expect([1, 2, 3, 4, 5].map((r) => roundName(r, 5))).toEqual([
      "Round of 32",
      "Round of 16",
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
    expect(roundName(1, 1)).toBe("Final");
  });
});
