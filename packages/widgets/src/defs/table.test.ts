import { describe, expect, it } from "vitest";
import { table } from "./table";

describe("table definition", () => {
  it("accepts its starter config unchanged", () => {
    expect(table.configSchema.parse(table.starter.config)).toEqual(table.starter.config);
  });

  it("applies defaults", () => {
    const config = table.configSchema.parse({
      columns: [{ id: "a", label: "A" }],
      rows: [{ id: "r1" }],
    });
    expect(config).toEqual({
      columns: [{ id: "a", label: "A", type: "text" }],
      rows: [{ id: "r1", cells: {} }],
      allowAddRows: true,
      allowAddColumns: false,
      summary: "none",
    });
  });

  it("rejects malformed input", () => {
    const col = { id: "a", label: "A" };
    const bad = [
      {},
      { columns: [] },
      { columns: [{ id: "a", label: "A", type: "date" }] },
      { columns: [{ id: "a", label: "A", type: "select" }] },
      { columns: [{ id: "a", label: "A", type: "select", options: [] }] },
      { columns: [col, col] },
      { columns: [col], rows: [{ id: "r" }, { id: "r" }] },
      { columns: [col], rows: [{ id: "r", cells: { a: { nested: true } } }] },
      { columns: [col], rows: [{ id: "r", cells: { a: Number.POSITIVE_INFINITY } }] },
      { columns: [col], summary: "average" },
      { columns: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: "x" })) },
    ];
    for (const input of bad)
      expect(table.configSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and lower-case keywords", () => {
    const lines = table.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    for (const word of table.keywords) expect(word).toBe(word.toLowerCase());
    expect(table.keywords).toContain("tablo");
  });
});
