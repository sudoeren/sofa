import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import { type BracketConfig, getWidgetDef, type WidgetDef } from "@sofra/widgets";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Bracket } from "./Bracket";

const me: MemberInfo = { id: "m1", name: "Mert", color: "#aa3355" };
const def = getWidgetDef("bracket") as WidgetDef<BracketConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: BracketConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Bracket
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

const players = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
const four = def.configSchema.parse({
  title: "Cup",
  participants: players(4),
  bestOf: 3,
  thirdPlace: true,
});
const match = (name: string) => screen.getByRole("group", { name });
const names = (name: string) =>
  [...match(name).querySelectorAll(".bk-name")].map((el) => el.textContent);
const champion = () => document.querySelector(".bk-champ-name")?.textContent;
const pick = (name: string, label: string) =>
  screen.getByRole("button", { name: `${name} wins, ${label}` });

afterEach(cleanup);

describe("Bracket", () => {
  it("renders the starter with its results", () => {
    const config = def.configSchema.parse(def.starter.config);
    render(<Harness config={config} initial={def.starter.initialState} />);
    expect(screen.getByText("Table tennis cup")).toBeTruthy();
    expect(screen.getByText("Best of 3")).toBeTruthy();
    expect(names("Quarterfinals match 1")).toEqual(["Elif", "Kaan"]);
    expect(names("Semifinals match 1")).toEqual(["Elif", "Ayse"]);
    expect(names("Semifinals match 2")).toEqual(["Can", "TBD"]);
    expect(champion()).toBe("To be decided");
  });

  it("picks winners through to a champion, then changes an early result", async () => {
    const user = userEvent.setup();
    render(<Harness config={four} />);
    expect(names("Semifinals match 1")).toEqual(["Player 1", "Player 4"]);
    expect(names("Semifinals match 2")).toEqual(["Player 2", "Player 3"]);
    expect(names("Final")).toEqual(["TBD", "TBD"]);

    await user.click(pick("Player 1", "Semifinals match 1"));
    expect(state["score:r1m1"]).toEqual({
      a: "p1",
      b: "p4",
      scoreA: null,
      scoreB: null,
      winner: "a",
    });
    await user.click(pick("Player 3", "Semifinals match 2"));
    expect(names("Final")).toEqual(["Player 1", "Player 3"]);
    expect(names("Third place")).toEqual(["Player 4", "Player 2"]);
    await user.click(pick("Player 3", "Final"));
    expect(state["score:r2m1"]).toEqual({
      a: "p1",
      b: "p3",
      scoreA: null,
      scoreB: null,
      winner: "b",
    });
    expect(champion()).toBe("Player 3");
    expect(pick("Player 3", "Final").getAttribute("aria-pressed")).toBe("true");

    // the first semifinal went the other way after all
    await user.click(pick("Player 4", "Semifinals match 1"));
    expect(names("Final")).toEqual(["Player 4", "Player 3"]);
    expect(pick("Player 3", "Final").getAttribute("aria-pressed")).toBe("false");
    expect(champion()).toBe("To be decided");
    expect(names("Third place")).toEqual(["Player 1", "Player 2"]);
    // the old final result is still stored but belongs to a matchup that no longer exists
    expect(state["score:r2m1"]).toMatchObject({ a: "p1", b: "p3" });
    await user.click(pick("Player 4", "Final"));
    expect(champion()).toBe("Player 4");

    // tapping the winner again clears the result
    await user.click(pick("Player 4", "Final"));
    expect("score:r2m1" in state).toBe(false);
    expect(champion()).toBe("To be decided");
  });

  it("takes scores and advances the higher one", async () => {
    const user = userEvent.setup();
    render(<Harness config={four} />);
    const label = "Semifinals match 2";
    await user.type(screen.getByLabelText(`Score of Player 2, ${label}`), "1{Enter}");
    expect(state["score:r1m2"]).toEqual({
      a: "p2",
      b: "p3",
      scoreA: 1,
      scoreB: null,
      winner: null,
    });
    expect(names("Final")).toEqual(["TBD", "TBD"]);
    await user.type(screen.getByLabelText(`Score of Player 3, ${label}`), "3");
    await user.tab();
    expect(state["score:r1m2"]).toEqual({ a: "p2", b: "p3", scoreA: 1, scoreB: 3, winner: "b" });
    expect(names("Final")).toEqual(["TBD", "Player 3"]);
    // a correction flips the winner
    const input = screen.getByLabelText(`Score of Player 2, ${label}`) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "5{Enter}");
    expect(names("Final")).toEqual(["TBD", "Player 2"]);
    // nonsense is not stored
    await user.clear(input);
    await user.type(input, "ab{Enter}");
    expect(input.value).toBe("5");
    expect(state["score:r1m2"]).toMatchObject({ scoreA: 5 });
    // matches that are not ready cannot be scored
    expect((screen.getByLabelText("Score of TBD, Third place") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("renames participants inline", async () => {
    const user = userEvent.setup();
    render(<Harness config={four} />);
    await user.click(screen.getByRole("button", { name: "Names" }));
    const input = screen.getByLabelText("Name of seed 4");
    await user.clear(input);
    await user.type(input, "Underdog{Enter}");
    expect(state["name:p4"]).toBe("Underdog");
    expect(names("Semifinals match 1")).toEqual(["Player 1", "Underdog"]);
  });

  it("gives byes to the top seeds", () => {
    render(<Harness config={def.configSchema.parse({ participants: players(5) })} />);
    expect(screen.queryByRole("group", { name: "Quarterfinals match 1" })).toBeNull();
    expect(names("Quarterfinals match 2")).toEqual(["Player 4", "Player 5"]);
    expect(names("Semifinals match 1")).toEqual(["Player 1", "TBD"]);
    expect(names("Semifinals match 2")).toEqual(["Player 2", "Player 3"]);
    expect(
      within(match("Semifinals match 1")).getAllByRole("button")[0]?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders 2 and 32 participants", () => {
    render(<Harness config={def.configSchema.parse({ participants: players(2) })} />);
    expect(names("Final")).toEqual(["Player 1", "Player 2"]);
    cleanup();
    render(<Harness config={def.configSchema.parse({ participants: players(32) })} />);
    expect(screen.getAllByRole("group", { name: /^Round of 32 match/ })).toHaveLength(16);
  });

  it("does not crash on hostile state", () => {
    const garbage: ToolState = {
      "score:r1m1": "p1",
      "score:r1m2": { a: "p2", b: "p3", scoreA: "3", scoreB: -1, winner: "p2" },
      "score:r2m1": { a: null, b: 4 },
      "score:third": [],
      "score:": {},
      "name:p1": { first: "x" },
      "name:p2": "",
      "name:nobody": "Ghost",
      junk: null,
    };
    render(<Harness config={four} initial={garbage} />);
    expect(names("Semifinals match 1")).toEqual(["Player 1", "Player 4"]);
    expect(champion()).toBe("To be decided");
    cleanup();
    render(<Harness config={{} as BracketConfig} initial={garbage} />);
    expect(screen.getByText("A bracket needs at least two participants.")).toBeTruthy();
  });
});
