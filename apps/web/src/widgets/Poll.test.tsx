import type { JsonValue, MemberInfo, ToolState } from "@sofa/shared";
import { getWidgetDef, type PollConfig, type WidgetDef } from "@sofa/widgets";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Poll } from "./Poll";

const me: MemberInfo = { id: "u1", name: "Ada Lovelace", color: "#aa3355" };
const bob: MemberInfo = { id: "u2", name: "Bob Stone", color: "#3355aa" };
const poll = getWidgetDef("poll") as WidgetDef<PollConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: PollConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Poll
      config={config}
      data={data}
      me={me}
      members={[me, bob]}
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

const base = poll.configSchema.parse(poll.starter.config);
afterEach(cleanup);

describe("Poll", () => {
  it("votes, changes the vote and retracts it", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.click(screen.getByRole("radio", { name: /Wood-fired pizza/ }));
    expect(state["vote:u1"]).toMatchObject({ name: "Ada Lovelace", choices: ["pizza"] });
    expect(
      screen.getByRole("radio", { name: /Wood-fired pizza/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("1 of 2 here has voted")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /Ramen bar/ }));
    expect(state["vote:u1"]).toMatchObject({ choices: ["ramen"] });

    await user.click(screen.getByRole("button", { name: "Clear my vote" }));
    expect("vote:u1" in state).toBe(false);
    expect(screen.getByText("0 of 2 here have voted")).toBeTruthy();
  });

  it("shows counts, percentages, the leader and voters, also for members who left", () => {
    render(
      <Harness
        config={base}
        initial={{
          "vote:u2": { name: "Bob Stone", choices: ["meze"], at: 1 },
          "vote:gone": { name: "Cem Kaya", choices: ["meze"], at: 2 },
          "vote:other": { name: "Dana", choices: ["ramen"], at: 3 },
        }}
      />,
    );
    const meze = screen.getByRole("radio", { name: /Meze place/ });
    expect(meze.getAttribute("data-leading")).toBe("true");
    expect(within(meze).getByText("2")).toBeTruthy();
    expect(within(meze).getByText("67%")).toBeTruthy();
    expect(within(meze).getByLabelText("Cem Kaya")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /Ramen bar/ }).getAttribute("data-leading"),
    ).toBeNull();
    expect(screen.getByText("1 of 2 here has voted, 2 more earlier")).toBeTruthy();
  });

  it("hides voters when anonymous and results until the member voted", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        config={{ ...base, anonymous: true, showResults: "afterVote" }}
        initial={{ "vote:u2": { name: "Bob Stone", choices: ["meze"], at: 1 } }}
      />,
    );
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.getByText("Results appear after you vote")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Ramen bar/ }));
    expect(screen.getAllByText("50%").length).toBe(2);
    expect(screen.queryByLabelText("Bob Stone")).toBeNull();
  });

  it("allows several choices when multiple", async () => {
    const user = userEvent.setup();
    render(<Harness config={{ ...base, multiple: true }} />);
    await user.click(screen.getByRole("checkbox", { name: /Wood-fired pizza/ }));
    await user.click(screen.getByRole("checkbox", { name: /Ramen bar/ }));
    expect(state["vote:u1"]).toMatchObject({ choices: ["pizza", "ramen"] });
    await user.click(screen.getByRole("checkbox", { name: /Wood-fired pizza/ }));
    expect(state["vote:u1"]).toMatchObject({ choices: ["ramen"] });
  });

  it("adds, renames and removes options", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.type(screen.getByLabelText("Add an option"), "Kebab house{Enter}");
    const added = Object.entries(state).find(([key]) => key.startsWith("option:"));
    expect(added?.[1]).toMatchObject({ label: "Kebab house", by: "u1" });
    const radios = screen.getAllByRole("radio");
    expect(radios[radios.length - 1]?.textContent).toContain("Kebab house");

    await user.click(screen.getByRole("button", { name: /Edit options/ }));
    const input = screen.getByLabelText("Rename option Ramen bar");
    await user.clear(input);
    await user.type(input, "Udon bar{Enter}");
    expect(state["option:ramen"]).toMatchObject({ label: "Udon bar" });
    await user.click(screen.getByRole("button", { name: "Remove option Wood-fired pizza" }));
    expect(state["removed:pizza"]).toBe(true);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("radio", { name: /pizza/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Udon bar/ })).toBeTruthy();
  });

  it("has no add or edit controls when allowAdd is off", () => {
    render(<Harness config={{ ...base, allowAdd: false }} />);
    expect(screen.queryByLabelText("Add an option")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit options/ })).toBeNull();
  });

  it("applies state overrides to config options and ignores votes for hidden ones", () => {
    render(
      <Harness
        config={base}
        initial={{
          "option:meze": { label: "Meze by the sea", createdAt: 5 },
          "removed:home": true,
          "option:x2": { label: "Second", createdAt: 20 },
          "option:x1": { label: "First", createdAt: 10 },
          "vote:u2": { name: "Bob Stone", choices: ["home"], at: 1 },
        }}
      />,
    );
    const labels = screen
      .getAllByRole("radio")
      .map((el) => el.querySelector(".poll-label")?.textContent);
    expect(labels).toEqual(["Meze by the sea", "Wood-fired pizza", "Ramen bar", "First", "Second"]);
    expect(screen.getByText("0 of 2 here have voted")).toBeTruthy();
  });

  it("survives garbage state", () => {
    const garbage = {
      "vote:u1": "pizza",
      "vote:u2": { choices: [1, null, { a: 1 }, "pizza", "pizza"], name: 7 },
      "vote:u3": null,
      "vote:u4": [1, 2],
      "vote:u5": { name: "X", choices: "ramen" },
      "vote:": { choices: ["pizza"] },
      "option:bad": 5,
      "option:bad2": { label: "   " },
      "option:ok": { label: "Fine", createdAt: "soon" },
      "removed:meze": "yes",
      unrelated: { deep: [1, 2, 3] },
    } as unknown as ToolState;
    render(<Harness config={base} initial={garbage} />);
    expect(screen.getAllByRole("radio").length).toBe(5);
    const pizza = screen.getByRole("radio", { name: /Wood-fired pizza/ });
    expect(within(pizza).getByText("1")).toBeTruthy();
    expect(within(pizza).getByLabelText("Bob Stone")).toBeTruthy();
  });
});
