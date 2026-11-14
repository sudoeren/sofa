import type { JsonValue, MemberInfo, ToolState } from "@sofa/shared";
import { getWidgetDef, type ItineraryConfig, type WidgetDef } from "@sofa/widgets";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Itinerary } from "./Itinerary";

const me: MemberInfo = { id: "m1", name: "Mert", color: "#aa3355" };
const zoe: MemberInfo = { id: "m2", name: "Zoe", color: "#3355aa" };
const def = getWidgetDef("itinerary") as WidgetDef<ItineraryConfig>;
let state: ToolState = {};

function Harness({ config, initial = {} }: { config: ItineraryConfig; initial?: ToolState }) {
  const [data, setData] = useState<ToolState>(initial);
  state = data;
  return (
    <Itinerary
      config={config}
      data={data}
      me={me}
      members={[me, zoe]}
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

const base = def.configSchema.parse({
  days: [
    { id: "d1", label: "Day 1", date: "2026-06-12" },
    { id: "d2", label: "Day 2" },
  ],
  stops: [
    {
      id: "s1",
      dayId: "d1",
      time: "09:00",
      title: "Breakfast",
      place: "Cafe Roma",
      link: "https://example.com/menu",
    },
    { id: "s2", dayId: "d1", title: "Souvenirs" },
    { id: "s3", dayId: "d1", title: "Postcards" },
  ],
});
const day = (name: string) => within(screen.getByRole("region", { name }));
const titles = (name: string) =>
  day(name)
    .queryAllByRole("listitem")
    .map((li) => li.querySelector(".it-title-text")?.textContent);

afterEach(cleanup);

describe("Itinerary", () => {
  it("renders the starter as a timeline", () => {
    render(
      <Harness
        config={def.configSchema.parse(def.starter.config)}
        initial={def.starter.initialState}
      />,
    );
    expect(titles("Friday")[0]).toBe("Land and take the metro into town");
    expect(day("Friday").getAllByText("Booked")).toHaveLength(2);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("adds a stop and moves it to another day", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    expect(titles("Day 1")).toEqual(["Breakfast", "Souvenirs", "Postcards"]);

    await user.type(day("Day 1").getByLabelText("New stop on Day 1"), "Museum{Enter}");
    const [key, stored] = Object.entries(state).find(([k]) => k.startsWith("stop:")) ?? ["", null];
    expect(stored).toEqual({
      dayId: "d1",
      time: "",
      title: "Museum",
      note: "",
      place: "",
      link: "",
      order: 3,
    });
    expect(titles("Day 1")).toEqual(["Breakfast", "Souvenirs", "Postcards", "Museum"]);

    await user.click(screen.getByRole("button", { name: "Details of Museum" }));
    await user.selectOptions(screen.getByLabelText("Day"), "Day 2");
    expect(state[key]).toMatchObject({ dayId: "d2", title: "Museum", order: 0 });
    expect(titles("Day 1")).toEqual(["Breakfast", "Souvenirs", "Postcards"]);
    expect(titles("Day 2")).toEqual(["Museum"]);
  });

  it("adds a timed stop in time order", async () => {
    render(<Harness config={base} />);
    fireEvent.change(day("Day 1").getByLabelText("Time of the new stop on Day 1"), {
      target: { value: "07:30" },
    });
    fireEvent.change(day("Day 1").getByLabelText("New stop on Day 1"), {
      target: { value: "Sunrise walk" },
    });
    fireEvent.click(day("Day 1").getByRole("button", { name: "Add stop to Day 1" }));
    expect(titles("Day 1")).toEqual(["Sunrise walk", "Breakfast", "Souvenirs", "Postcards"]);
  });

  it("reorders stops that share a time and refuses to cross times", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.click(screen.getByRole("button", { name: "Details of Postcards" }));
    expect((screen.getByRole("button", { name: "Move down" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(titles("Day 1")).toEqual(["Breakfast", "Postcards", "Souvenirs"]);
    expect(state["stop:s3"]).toMatchObject({ dayId: "d1", title: "Postcards" });
    // the next neighbour up has a time, so it cannot move further
    expect((screen.getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect(titles("Day 1")).toEqual(["Breakfast", "Souvenirs", "Postcards"]);
  });

  it("edits fields, marks done and booked, and joins", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        config={base}
        initial={{ "going:s1:m2": { name: "Zoe" }, "going:s1:gone": { name: "Old Friend" } }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Details of Breakfast" }));
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    await user.clear(title);
    await user.type(title, "Big breakfast{Enter}");
    expect(state["stop:s1"]).toMatchObject({
      title: "Big breakfast",
      time: "09:00",
      place: "Cafe Roma",
      order: 0,
    });
    // an empty title is refused and the stored one comes back
    await user.clear(screen.getByLabelText("Title"));
    await user.tab();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Big breakfast");

    await user.click(screen.getByRole("button", { name: "Big breakfast: done" }));
    expect(state["done:s1"]).toBe(true);
    await user.click(screen.getByRole("button", { name: "Big breakfast: done" }));
    expect("done:s1" in state).toBe(false);

    await user.click(screen.getByRole("button", { name: "I'm in: Big breakfast" }));
    expect(state["going:s1:m1"]).toEqual({ name: "Mert" });
    expect(screen.getByLabelText("3 joining")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Old Friend" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "I'm in: Big breakfast" }));
    expect("going:s1:m1" in state).toBe(false);

    await user.click(screen.getByRole("button", { name: "Booked" }));
    expect(state["booked:s1"]).toBe(true);
    const note = screen.getByLabelText("Note");
    await user.type(note, "Bring cash");
    await user.tab();
    expect(state["stop:s1"]).toMatchObject({ note: "Bring cash" });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "10:15" } });
    expect(state["stop:s1"]).toMatchObject({ time: "10:15" });

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(state["removed:stop:s1"]).toBe(true);
    expect(titles("Day 1")).toEqual(["Souvenirs", "Postcards"]);
  });

  it("only shows http and https links", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/menu");
    await user.click(screen.getByRole("button", { name: "Details of Breakfast" }));
    const link = screen.getByLabelText("Link");
    await user.clear(link);
    await user.type(link, "javascript:alert(1){Enter}");
    expect(state["stop:s1"]).toMatchObject({ link: "javascript:alert(1)" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Only http and https links are shown.")).toBeTruthy();
  });

  it("adds, renames and removes days", async () => {
    const user = userEvent.setup();
    render(<Harness config={base} />);
    await user.click(screen.getByRole("button", { name: "Add a day" }));
    expect(screen.getByRole("region", { name: "Day 3" })).toBeTruthy();
    const label = screen.getByLabelText("Name of Day 2");
    await user.clear(label);
    await user.type(label, "Sunday{Enter}");
    expect(state["day:d2"]).toEqual({ label: "Sunday", date: "", order: 1 });

    await user.click(screen.getByRole("button", { name: "Options for Day 1" }));
    await user.click(screen.getByRole("button", { name: "Remove day" }));
    expect("removed:day:d1" in state).toBe(false);
    await user.click(screen.getByRole("button", { name: "Remove with 3 stops?" }));
    expect(state["removed:day:d1"]).toBe(true);
    expect(screen.queryByRole("region", { name: "Day 1" })).toBeNull();
  });

  it("hides adding when allowAdd is off", () => {
    render(<Harness config={{ ...base, allowAdd: false }} />);
    expect(screen.queryByRole("button", { name: "Add a day" })).toBeNull();
    expect(screen.queryByLabelText("New stop on Day 1")).toBeNull();
  });

  it("does not crash on hostile state", () => {
    const garbage: ToolState = {
      "stop:s1": 7,
      "stop:s2": { dayId: {}, title: [] },
      "stop:x": {
        dayId: "d1",
        title: "Odd one",
        time: 900,
        note: { a: 1 },
        link: "data:text/html,x",
        order: null,
      },
      "stop:y": { dayId: "nowhere", title: "Lost" },
      "day:d1": "Monday",
      "day:z": { label: 5 },
      "day:ok": { label: "Extra", date: "not a date", order: "x" },
      "done:s1": "yes",
      "booked:s2": 1,
      "going:s1:m1": 5,
      "going:s1": { name: "x" },
      "going:": null,
      "removed:day:d2": "true",
      junk: [[[]]],
    };
    render(<Harness config={base} initial={garbage} />);
    expect(titles("Day 1")).toEqual(["Breakfast", "Odd one", "Souvenirs", "Postcards"]);
    expect(screen.getByRole("region", { name: "Extra" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    render(<Harness config={{} as ItineraryConfig} initial={garbage} />);
  });
});
