import { describe, expect, it } from "vitest";
import { resolveBracket } from "./defs/bracket";
import { resolveExpenses } from "./defs/expenses";
import { resolveItinerary } from "./defs/itinerary";
import { resolveSeating } from "./defs/seating";
import { EXAMPLES, getExample } from "./examples";
import { getWidgetDef } from "./index";

/**
 * Key patterns a guide documents, as regular expressions: `vote:<memberId>` becomes
 * ^vote:[A-Za-z0-9_-]+$, `"removed:person:<id>"` becomes ^removed:person:[A-Za-z0-9_-]+$.
 */
function documentedKeys(guide: string): RegExp[] {
  const patterns = guide.match(/[A-Za-z]+(?::[A-Za-z]+)*(?::<[A-Za-z]+>)+/g) ?? [];
  return [...new Set(patterns)].map((pattern) => {
    const source = pattern
      .split(/(<[A-Za-z]+>)/)
      .map((part) =>
        part.startsWith("<") ? "[A-Za-z0-9_-]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return new RegExp(`^${source}$`);
  });
}

describe("example spaces", () => {
  it("have unique ids and at least two tools each", () => {
    const ids = EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const example of EXAMPLES) {
      expect(example.tools.length).toBeGreaterThanOrEqual(2);
      expect(getExample(example.id)).toBe(example);
    }
    expect(getExample("nope")).toBeUndefined();
  });

  for (const example of EXAMPLES) {
    describe(example.id, () => {
      for (const tool of example.tools) {
        const def = getWidgetDef(tool.widgetType);

        it(`${tool.title}: config passes the ${tool.widgetType} schema unchanged`, () => {
          expect(def).toBeDefined();
          const parsed = def?.configSchema.safeParse(tool.config);
          expect(parsed?.error).toBeUndefined();
          // Every default is spelled out, so what is stored is what was written.
          expect(parsed?.data).toEqual(tool.config);
        });

        it(`${tool.title}: state uses only documented keys`, () => {
          const patterns = documentedKeys(def?.guide ?? "");
          expect(patterns.length).toBeGreaterThan(0);
          for (const key of Object.keys(tool.state)) {
            const known = patterns.some((pattern) => pattern.test(key));
            expect(known, `${tool.widgetType} key ${key}`).toBe(true);
          }
        });
      }

      it("materials are notes and links with content", () => {
        for (const material of example.materials ?? []) {
          expect(["note", "link"]).toContain(material.kind);
          if (material.kind === "note") expect(material.text?.length).toBeGreaterThan(0);
          if (material.kind === "link") expect(material.url).toMatch(/^https:\/\//);
        }
      });
    });
  }

  it("seed state the widgets actually pick up", () => {
    for (const example of EXAMPLES) {
      for (const tool of example.tools) {
        const def = getWidgetDef(tool.widgetType);
        const config = def?.configSchema.parse(tool.config);
        if (tool.widgetType === "bracket") {
          const view = resolveBracket(config.participants, tool.state, config.thirdPlace);
          const played = view.rounds.flat().filter((match) => match.winner !== null);
          expect(played.length).toBe(Object.keys(tool.state).length);
        }
        if (tool.widgetType === "expenses") {
          const view = resolveExpenses(config, tool.state);
          const added = Object.keys(tool.state).filter((key) => key.startsWith("expense:"));
          expect(view.expenses.length).toBe(config.expenses.length + added.length);
        }
        if (tool.widgetType === "itinerary") {
          const stops = resolveItinerary(config, tool.state).flatMap((day) => day.stops);
          const added = Object.keys(tool.state).filter((key) => key.startsWith("stop:"));
          expect(stops.length).toBe(config.stops.length + added.length);
        }
        if (tool.widgetType === "seating") {
          const view = resolveSeating(config, tool.state);
          const seated = view.tables.reduce((sum, table) => sum + table.guests.length, 0);
          expect(seated).toBe(Object.keys(tool.state).length);
        }
        if (tool.widgetType === "poll") {
          const options = new Set(config.options.map((option: { id: string }) => option.id));
          for (const value of Object.values(tool.state)) {
            for (const choice of (value as { choices: string[] }).choices)
              expect(options.has(choice)).toBe(true);
          }
        }
      }
    }
  });
});
