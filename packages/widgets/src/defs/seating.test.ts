import { describe, expect, it } from "vitest";
import { canSeat, cleanSeats, freeSeats, orderAfter, resolveSeating, seating } from "./seating";

const schema = seating.configSchema;

describe("seating config", () => {
  it("accepts the starter and its initial state fits", () => {
    const config = schema.parse(seating.starter.config);
    const view = resolveSeating(config, seating.starter.initialState ?? {});
    expect(view.tables.map((t) => t.guests.length)).toEqual([3, 2, 2]);
    expect(view.pool).toHaveLength(7);
    expect(view.tables.every((t) => t.guests.length <= t.seats)).toBe(true);
  });

  it("applies defaults", () => {
    expect(schema.parse({})).toEqual({ tables: [], guests: [], allowAdd: true });
  });

  it("rejects malformed input", () => {
    const bad = [
      { tables: [{ id: "t", name: "T", seats: 0 }] },
      { tables: [{ id: "t", name: "T", seats: 31 }] },
      { tables: [{ id: "t", name: "T", seats: 2.5 }] },
      { tables: [{ id: "t", name: "T" }] },
      { tables: [{ id: "t", name: "", seats: 4 }] },
      {
        tables: [
          { id: "t", name: "A", seats: 4 },
          { id: "t", name: "B", seats: 4 },
        ],
      },
      {
        guests: [
          { id: "g", name: "G" },
          { id: "g", name: "H" },
        ],
      },
      { guests: [{ id: "g:1", name: "G" }] },
      { guests: ["Ada"] },
      { allowAdd: 1 },
      { guests: Array.from({ length: 301 }, (_, i) => ({ id: `g${i}`, name: "G" })) },
    ];
    for (const input of bad)
      expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and keywords", () => {
    const lines = seating.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    expect(seating.keywords).toContain("oturma");
  });
});

describe("resolveSeating", () => {
  const config = schema.parse({
    tables: [
      { id: "t1", name: "One", seats: 2 },
      { id: "t2", name: "Two", seats: 3 },
    ],
    guests: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bora" },
      { id: "c", name: "Cem" },
    ],
  });

  it("starts with everyone in the pool", () => {
    const view = resolveSeating(config, {});
    expect(view.pool.map((g) => g.id)).toEqual(["a", "b", "c"]);
    expect(view.tables.map((t) => [t.id, t.guests.length, freeSeats(t)])).toEqual([
      ["t1", 0, 2],
      ["t2", 0, 3],
    ]);
  });

  it("seats, renames, adds and removes", () => {
    const view = resolveSeating(config, {
      "seat:a": "t1",
      "seat:c": "t1",
      "seat:b": "t2",
      "seat:n1": "x1",
      "guest:b": { name: "Bora K." },
      "guest:n2": { name: "Late", order: 4 },
      "guest:n1": { name: "New", order: 3 },
      "removed:guest:c": true,
      "table:t2": { name: "Second", seats: 5 },
      "table:x1": { name: "Extra", seats: 1, order: 2 },
    });
    expect(view.tables.map((t) => [t.id, t.name, t.seats, t.guests.map((g) => g.name)])).toEqual([
      ["t1", "One", 2, ["Ada"]],
      ["t2", "Second", 5, ["Bora K."]],
      ["x1", "Extra", 1, ["New"]],
    ]);
    expect(view.pool.map((g) => g.id)).toEqual(["n2"]);
    expect(view.guests.map((g) => g.id)).toEqual(["a", "b", "n1", "n2"]);
  });

  it("returns the guests of a removed table to the pool", () => {
    const view = resolveSeating(config, {
      "seat:a": "t1",
      "seat:b": "t1",
      "removed:table:t1": true,
    });
    expect(view.tables.map((t) => t.id)).toEqual(["t2"]);
    expect(view.pool.map((g) => [g.id, g.tableId])).toEqual([
      ["a", null],
      ["b", null],
      ["c", null],
    ]);
  });

  it("respects capacity", () => {
    const view = resolveSeating(config, { "seat:a": "t1", "seat:b": "t1" });
    const full = view.tables[0];
    if (!full) throw new Error("no table");
    expect(freeSeats(full)).toBe(0);
    expect(canSeat(full, "c")).toBe(false);
    expect(canSeat(full, "a")).toBe(true);
    const other = view.tables[1];
    expect(other && canSeat(other, "c")).toBe(true);
    // two people seating at once can overfill a table; it is shown, not hidden
    const over = resolveSeating(config, { "seat:a": "t1", "seat:b": "t1", "seat:c": "t1" })
      .tables[0];
    expect(over?.guests).toHaveLength(3);
    expect(over && freeSeats(over)).toBe(0);
  });

  it("survives garbage", () => {
    const view = resolveSeating(config, {
      "seat:a": 5,
      "seat:b": { table: "t1" },
      "seat:c": "nowhere",
      "seat:ghost": "t1",
      "guest:": { name: "No id" },
      "guest:x": "string",
      "guest:y": { name: "" },
      "guest:a": { name: ["x"] },
      "table:t1": { name: 7, seats: "many" },
      "table:z1": { name: "No seats" },
      "table:z2": { name: "Huge", seats: 1e9, order: "x" },
      "table:z3": [],
      "removed:table:t2": "true",
    });
    expect(view.pool.map((g) => g.name)).toEqual(["Ada", "Bora", "Cem"]);
    expect(view.tables.map((t) => [t.id, t.name, t.seats])).toEqual([
      ["t1", "One", 2],
      ["t2", "Two", 3],
      ["z2", "Huge", 30],
    ]);
  });

  it("has small helpers", () => {
    expect(cleanSeats(4.4)).toBe(4);
    expect(cleanSeats(0)).toBe(1);
    expect(cleanSeats(99)).toBe(30);
    expect(cleanSeats("4")).toBeNull();
    expect(cleanSeats(Number.NaN)).toBeNull();
    expect(orderAfter([])).toBe(0);
    expect(orderAfter([{ order: 7 }, { order: 2 }])).toBe(8);
  });
});
