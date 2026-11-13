import { describe, expect, it } from "vitest";
import { poll } from "./poll";

describe("poll definition", () => {
  it("accepts its starter config unchanged", () => {
    expect(poll.configSchema.parse(poll.starter.config)).toEqual(poll.starter.config);
  });

  it("applies defaults", () => {
    const config = poll.configSchema.parse({ question: "  Lunch?  " });
    expect(config).toEqual({
      question: "Lunch?",
      options: [],
      multiple: false,
      allowAdd: true,
      anonymous: false,
      showResults: "always",
    });
  });

  it("rejects malformed input", () => {
    const bad = [
      {},
      { question: "" },
      { question: "Q", options: "a,b" },
      {
        question: "Q",
        options: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
      },
      { question: "Q", options: [{ id: "has:colon", label: "A" }] },
      { question: "Q", options: [{ id: "a", label: "" }] },
      { question: "Q", allowAdd: false, options: [{ id: "a", label: "A" }] },
      { question: "Q", showResults: "never" },
      { question: "Q", multiple: "yes" },
      { question: "Q".repeat(201) },
      {
        question: "Q",
        options: Array.from({ length: 21 }, (_, i) => ({ id: `o${i}`, label: "x" })),
      },
    ];
    for (const input of bad)
      expect(poll.configSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });

  it("has a guide and lower-case keywords", () => {
    const lines = poll.guide.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(6);
    expect(lines).toBeLessThanOrEqual(12);
    for (const word of poll.keywords) expect(word).toBe(word.toLowerCase());
    expect(poll.keywords).toContain("anket");
  });
});
