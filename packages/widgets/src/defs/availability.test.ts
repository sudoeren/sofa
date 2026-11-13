import { describe, expect, it } from "vitest";
import { availability } from "./availability";

describe("availability definition", () => {
  it("accepts its starter config unchanged", () => {
    expect(availability.configSchema.parse(availability.starter.config)).toEqual(
      availability.starter.config,
    );
  });

  it("applies defaults", () => {
    expect(availability.configSchema.parse({ prompt: "When?" })).toEqual({
      prompt: "When?",
      slots: [],
      allowMaybe: true,
      allowAdd: true,
    });
  });

  it("rejects malformed input", () => {
    const bad = [
      {},
      { prompt: "" },
      { prompt: "When?", slots: [{ id: "a" }] },
      { prompt: "When?", slots: [{ id: "a:b", label: "Fri" }] },
      {
        prompt: "When?",
        slots: [
          { id: "a", label: "Fri" },
          { id: "a", label: "Sat" },
        ],
      },
      { prompt: "When?", allowAdd: false },
      { prompt: "When?", allowMaybe: 1 },
      {
        prompt: "When?",
        slots: Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, label: "x" })),
      },
    ];
    for (const input of bad)
      expect(availability.configSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and lower-case keywords", () => {
    const lines = availability.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    for (const word of availability.keywords) expect(word).toBe(word.toLowerCase());
    expect(availability.keywords).toContain("musait");
  });
});
