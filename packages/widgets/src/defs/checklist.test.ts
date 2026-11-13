import { describe, expect, it } from "vitest";
import { checklist } from "./checklist";

describe("checklist definition", () => {
  it("accepts its starter config unchanged", () => {
    expect(checklist.configSchema.parse(checklist.starter.config)).toEqual(
      checklist.starter.config,
    );
  });

  it("applies defaults", () => {
    expect(checklist.configSchema.parse({})).toEqual({
      items: [],
      assignable: true,
      showProgress: true,
    });
    const config = checklist.configSchema.parse({ items: [{ id: "a", text: " Tent " }] });
    expect(config.items).toEqual([{ id: "a", text: "Tent" }]);
  });

  it("rejects malformed input", () => {
    const bad = [
      null,
      { items: {} },
      { items: [{ text: "no id" }] },
      { items: [{ id: "a", text: "" }] },
      { items: [{ id: "a b", text: "x" }] },
      {
        items: [
          { id: "a", text: "x" },
          { id: "a", text: "y" },
        ],
      },
      { items: [{ id: "a", text: "x", section: 4 }] },
      { assignable: "no" },
      { items: Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, text: "x" })) },
    ];
    for (const input of bad)
      expect(checklist.configSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and lower-case keywords", () => {
    const lines = checklist.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    for (const word of checklist.keywords) expect(word).toBe(word.toLowerCase());
    expect(checklist.keywords).toContain("yapilacak");
  });
});
