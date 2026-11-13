import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import { type AvailabilityConfig, getWidgetDef, type WidgetDef } from "@sofra/widgets";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Availability } from "./Availability";

const me: MemberInfo = { id: "u1", name: "Ada Lovelace", color: "#aa3355" };
const bob: MemberInfo = { id: "u2", name: "Bob Stone", color: "#3355aa" };
const availability = getWidgetDef("availability") as WidgetDef<AvailabilityConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: AvailabilityConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Availability
      config={config}
      data={data}
      me={me}
      members={[bob, me]}
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

const base = availability.configSchema.parse({
  prompt: "Dinner?",
  slots: [
    { id: "fri", label: "Fri evening" },
    { id: "sat", label: "Sat evening" },
    { id: "sun", label: "Sun lunch" },
  ],
});
const best = () =>
  screen
    .getAllByRole("columnheader")
    .filter((th) => th.getAttribute("data-best") === "true")
    .map((th) => th.textContent);
const names = () =>
  screen
    .getAllByRole("rowheader")
    .map((th) => (th.querySelector(".av-name-text") ?? th).textContent);
afterEach(cleanup);

describe("Availability", () => {
  it("cycles the member's own cell: yes, maybe, no, unset", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    const cell = () => screen.getByRole("button", { name: /^Fri evening:/ });
    expect(cell().getAttribute("aria-label")).toBe("Fri evening: no answer");
    await user.click(cell());
    expect(state["answer:u1:fri"]).toBe("yes");
    expect(state["who:u1"]).toEqual({ name: "Ada Lovelace", color: "#aa3355" });
    expect(cell().getAttribute("aria-label")).toBe("Fri evening: yes");
    await user.click(cell());
    expect(state["answer:u1:fri"]).toBe("maybe");
    await user.click(cell());
    expect(state["answer:u1:fri"]).toBe("no");
    await user.click(cell());
    expect("answer:u1:fri" in state).toBe(false);
  });

  it("skips maybe when it is not allowed", async () => {
    const user = userEvent.setup();
    render(<Harness config={{ ...base, allowMaybe: false }} />);
    const cell = screen.getByRole("button", { name: /^Sat evening:/ });
    await user.click(cell);
    await user.click(cell);
    expect(state["answer:u1:sat"]).toBe("no");
  });

  it("puts the member first, lists absent people by stored name and highlights the best slot", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        config={base}
        initial={{
          "answer:u2:fri": "yes",
          "answer:u2:sat": "yes",
          "answer:gone:sat": "yes",
          "answer:gone:fri": "no",
          "answer:gone:sun": "maybe",
          "who:gone": { name: "Cem Kaya", color: "#118833" },
        }}
      />,
    );
    expect(names()).toEqual(["You", "Bob Stone", "Cem Kaya", "Can make it"]);
    expect(best()).toEqual(["Sat evening"]);
    expect(screen.getByText("1 of 2 here has answered")).toBeTruthy();
    expect(screen.getByLabelText("Sat evening: 2 yes, 0 maybe, 0 no")).toBeTruthy();
    expect(screen.getByLabelText("Cem Kaya, Sun lunch: maybe")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Fri evening:/ }));
    // fri and sat both have 2 yes, but fri also has a no
    expect(best()).toEqual(["Sat evening"]);
    await user.click(screen.getByRole("button", { name: /^Sun lunch:/ }));
    await user.click(screen.getByRole("button", { name: /^Sat evening:/ }));
    expect(best()).toEqual(["Sat evening"]);
    expect(screen.getByText("Sat evening", { selector: ".w-strong" })).toBeTruthy();
  });

  it("highlights every tied slot and none when nobody said yes", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} initial={{ "answer:u2:fri": "no" }} />);
    expect(best()).toEqual([]);
    await user.click(screen.getByRole("button", { name: /^Sat evening:/ }));
    await user.click(screen.getByRole("button", { name: /^Sun lunch:/ }));
    expect(best()).toEqual(["Sat evening", "Sun lunch"]);
  });

  it("adds, renames and removes slots", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} initial={{ "answer:u2:sat": "yes" }} />);
    await user.type(screen.getByLabelText("Add a time"), "Mon evening{Enter}");
    const added = Object.entries(state).find(([key]) => key.startsWith("slot:"));
    expect(added?.[1]).toMatchObject({ label: "Mon evening" });
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Member",
      "Fri evening",
      "Sat evening",
      "Sun lunch",
      "Mon evening",
    ]);
    await user.click(screen.getByRole("button", { name: /Edit times/ }));
    const input = screen.getByLabelText("Rename time Fri evening");
    await user.clear(input);
    await user.type(input, "Fri late{Enter}");
    expect(state["slot:fri"]).toMatchObject({ label: "Fri late" });
    await user.click(screen.getByRole("button", { name: "Remove time Sat evening" }));
    expect(state["removed:sat"]).toBe(true);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Member",
      "Fri late",
      "Sun lunch",
      "Mon evening",
    ]);
    // the only yes was on the removed slot
    expect(best()).toEqual([]);
  });

  it("survives garbage state", () => {
    const garbage = {
      "answer:u1:fri": "YES",
      "answer:u2:sat": 1,
      "answer:u3": "yes",
      "answer::fri": "yes",
      "answer:a:b:sat": "yes",
      "answer:u9:nope": "yes",
      "who:a:b": "name",
      "who:u2": 42,
      "slot:bad": "x",
      "slot:ok": { label: "Extra", createdAt: {} },
      "removed:sun": {},
      junk: null,
    } as unknown as ToolState;
    render(<Harness config={base} initial={garbage} />);
    expect(screen.getAllByRole("columnheader").length).toBe(5);
    expect(names()).toEqual(["You", "Bob Stone", "Someone", "Can make it"]);
    expect(best()).toEqual(["Sat evening"]);
  });

  it("shows an empty state without slots", () => {
    render(<Harness config={availability.configSchema.parse({ prompt: "When?" })} />);
    expect(screen.getByText(/No times yet/)).toBeTruthy();
  });
});
