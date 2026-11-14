import { describe, expect, it } from "vitest";
import {
  cleanDate,
  cleanTime,
  formatDayDate,
  itinerary,
  moveOrder,
  orderAfter,
  resolveItinerary,
  safeLink,
  toStoredStop,
} from "./itinerary";

const schema = itinerary.configSchema;

describe("itinerary config", () => {
  it("accepts the starter", () => {
    expect(schema.safeParse(itinerary.starter.config).success).toBe(true);
  });

  it("applies defaults", () => {
    expect(schema.parse({})).toEqual({ days: [], stops: [], allowAdd: true });
  });

  it("rejects malformed input", () => {
    const days = [{ id: "d1", label: "Day 1" }];
    const bad = [
      { days: [{ id: "d1" }] },
      { days: [{ id: "d 1", label: "Day 1" }] },
      { days: [{ id: "d1", label: "Day 1", date: "12/06/2026" }] },
      { days: [{ id: "d1", label: "Day 1", date: "2026-13-01" }] },
      { days: [...days, ...days] },
      { days, stops: [{ id: "s", dayId: "nope", title: "x" }] },
      { days, stops: [{ id: "s", dayId: "d1", title: "" }] },
      { days, stops: [{ id: "s", dayId: "d1", title: "x", time: "25:00" }] },
      { days, stops: [{ id: "s", dayId: "d1", title: "x", time: "9:00" }] },
      {
        days,
        stops: [
          { id: "s", dayId: "d1", title: "x" },
          { id: "s", dayId: "d1", title: "y" },
        ],
      },
      { days, allowAdd: "yes" },
      { days: Array.from({ length: 32 }, (_, i) => ({ id: `d${i}`, label: "D" })) },
      [],
    ];
    for (const input of bad)
      expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and keywords", () => {
    const lines = itinerary.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    expect(itinerary.keywords).toEqual(expect.arrayContaining(["gezi", "plan"]));
  });
});

describe("helpers", () => {
  it("cleans times and dates", () => {
    expect(cleanTime("09:30")).toBe("09:30");
    expect(cleanTime("24:00")).toBe("");
    expect(cleanTime(930)).toBe("");
    expect(cleanDate("2026-02-28")).toBe("2026-02-28");
    expect(cleanDate("2026-02-30")).toBe("");
    expect(cleanDate(undefined)).toBe("");
    expect(formatDayDate("2026-05-15", "en-GB")).toMatch(/^Fri,? 15 May$/);
    expect(formatDayDate("garbage")).toBe("");
  });

  it("only lets http and https links through", () => {
    expect(safeLink("https://www.example.com/")).toEqual({
      href: "https://www.example.com/",
      text: "example.com",
    });
    expect(safeLink(" http://example.com/a/b/ ")?.text).toBe("example.com/a/b");
    expect(safeLink(`https://example.com/${"x".repeat(80)}`)?.text.length).toBe(42);
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<b>x</b>",
      "ftp://example.com",
      "example.com",
      "//example.com",
      "https://",
      "http:// bad host",
      "",
      42,
      null,
      { href: "https://example.com" },
    ]) {
      expect(safeLink(bad), String(bad)).toBeNull();
    }
  });
});

describe("resolveItinerary", () => {
  const config = schema.parse({
    days: [
      { id: "d1", label: "Day 1", date: "2026-06-12" },
      { id: "d2", label: "Day 2" },
    ],
    stops: [
      { id: "late", dayId: "d1", time: "18:00", title: "Dinner" },
      { id: "free", dayId: "d1", title: "Souvenirs" },
      {
        id: "early",
        dayId: "d1",
        time: "08:15",
        title: "Breakfast",
        place: "Cafe",
        link: "https://example.com",
      },
      { id: "other", dayId: "d2", title: "Beach" },
    ],
  });
  const ids = (dayIndex: number, data = {}) =>
    resolveItinerary(config, data)[dayIndex]?.stops.map((s) => s.id);

  it("sorts timed stops by time and untimed ones after them", () => {
    expect(ids(0)).toEqual(["early", "late", "free"]);
    expect(ids(1)).toEqual(["other"]);
  });

  it("applies edits, moves between days, removals and additions", () => {
    const days = resolveItinerary(config, {
      "stop:free": {
        dayId: "d2",
        time: "",
        title: "Souvenir hunt",
        note: "",
        place: "",
        link: "",
        order: 9,
      },
      "removed:stop:late": true,
      "stop:n1": { dayId: "d1", time: "08:15", title: "Coffee first", order: 0.5 },
      "stop:n2": { dayId: "d3", time: "", title: "On a new day", order: 0 },
      "day:d3": { label: "Day 3", date: "2026-06-14", order: 2 },
      "day:d2": { label: "Sunday" },
      "done:early": true,
      "booked:early": true,
      "going:early:m2": { name: "Zoe" },
      "going:early:m1": { name: "Ali" },
    });
    expect(days.map((d) => [d.id, d.label, d.date])).toEqual([
      ["d1", "Day 1", "2026-06-12"],
      ["d2", "Sunday", ""],
      ["d3", "Day 3", "2026-06-14"],
    ]);
    expect(days[0]?.stops.map((s) => s.id)).toEqual(["n1", "early"]);
    expect(days[1]?.stops.map((s) => [s.id, s.title])).toEqual([
      ["other", "Beach"],
      ["free", "Souvenir hunt"],
    ]);
    expect(days[2]?.stops.map((s) => s.id)).toEqual(["n2"]);
    const early = days[0]?.stops[1];
    expect(early).toMatchObject({ done: true, booked: true, place: "Cafe" });
    expect(early?.going).toEqual([
      { id: "m1", name: "Ali" },
      { id: "m2", name: "Zoe" },
    ]);
  });

  it("hides the stops of a removed day and brings them back with it", () => {
    expect(resolveItinerary(config, { "removed:day:d1": true }).map((d) => d.id)).toEqual(["d2"]);
    expect(resolveItinerary(config, { "removed:day:d1": false }).map((d) => d.id)).toEqual([
      "d1",
      "d2",
    ]);
  });

  it("survives garbage", () => {
    const days = resolveItinerary(config, {
      "stop:early": "broken",
      "stop:late": { dayId: "d1", title: "" },
      "stop:x1": { dayId: "missing", title: "Lost" },
      "stop:x2": { dayId: 5, title: "Bad day" },
      "stop:x3": { dayId: "d1", title: "Odd", time: "soon", order: "first", note: 7, link: ["a"] },
      "stop:": { dayId: "d1", title: "No id" },
      "day:x": { label: "" },
      "day:y": null,
      "done:early": "yes",
      "going:early": { name: "No member" },
      "going::m": { name: "No stop" },
      "going:early:m": { name: 12 },
      "removed:stop:free": 1,
    });
    expect(days.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(days[0]?.stops.map((s) => [s.id, s.time, s.title])).toEqual([
      ["early", "08:15", "Breakfast"],
      ["late", "18:00", "Dinner"],
      ["x3", "", "Odd"],
      ["free", "", "Souvenirs"],
    ]);
    expect(days[0]?.stops[0]).toMatchObject({ done: false, going: [] });
  });
});

describe("ordering", () => {
  const config = schema.parse({
    days: [{ id: "d", label: "Day" }],
    stops: [
      { id: "t1", dayId: "d", time: "10:00", title: "Timed" },
      { id: "a", dayId: "d", title: "A" },
      { id: "b", dayId: "d", title: "B" },
      { id: "c", dayId: "d", title: "C" },
    ],
  });
  const apply = (data: Record<string, unknown>, id: string, direction: -1 | 1) => {
    const stops = resolveItinerary(config, data as never)[0]?.stops ?? [];
    const stop = stops.find((s) => s.id === id);
    const order = moveOrder(stops, id, direction);
    if (!stop || order === null) return null;
    return { ...data, [`stop:${id}`]: toStoredStop(stop, { order }) };
  };
  const order = (data: Record<string, unknown>) =>
    resolveItinerary(config, data as never)[0]?.stops.map((s) => s.id);

  it("moves a stop up and down among stops with the same time", () => {
    let data: Record<string, unknown> = {};
    data = apply(data, "c", -1) ?? data;
    expect(order(data)).toEqual(["t1", "a", "c", "b"]);
    data = apply(data, "c", -1) ?? data;
    expect(order(data)).toEqual(["t1", "c", "a", "b"]);
    data = apply(data, "c", 1) ?? data;
    expect(order(data)).toEqual(["t1", "a", "c", "b"]);
    data = apply(data, "a", 1) ?? data;
    data = apply(data, "a", 1) ?? data;
    expect(order(data)).toEqual(["t1", "c", "b", "a"]);
  });

  it("does not move past the ends or across a different time", () => {
    expect(apply({}, "a", -1)).toBeNull();
    expect(apply({}, "c", 1)).toBeNull();
    expect(apply({}, "t1", 1)).toBeNull();
    expect(apply({}, "t1", -1)).toBeNull();
    expect(apply({}, "missing", 1)).toBeNull();
  });

  it("still moves when sort keys are tied", () => {
    const tied = {
      "stop:a": { dayId: "d", title: "A", order: 1 },
      "stop:b": { dayId: "d", title: "B", order: 1 },
      "stop:c": { dayId: "d", title: "C", order: 1 },
    };
    expect(order(tied)).toEqual(["t1", "a", "b", "c"]);
    expect(order(apply(tied, "c", -1) ?? {})?.indexOf("c")).toBeLessThan(2 + 1);
    expect(order(apply(tied, "a", 1) ?? {})?.indexOf("a")).toBeGreaterThan(1);
  });

  it("puts new items after the existing ones", () => {
    expect(orderAfter([])).toBe(0);
    expect(orderAfter([{ order: 2.5 }, { order: 1 }])).toBe(3);
  });
});
