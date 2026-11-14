import type { WidgetDef } from "@sofa/widgets";

/** Starter matching for requests that arrive when no AI provider is available. */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count whole-word, case-insensitive occurrences of a word or phrase. */
function occurrences(haystack: string, needle: string): number {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return 0;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
  return (haystack.match(pattern) ?? []).length;
}

export type StarterMatch = { def: WidgetDef; score: number };

/**
 * Simple scoring: every keyword that appears as a whole word counts once, weighted by
 * its number of words so that "seating chart" beats "chart". The type id and the title
 * count as strong keywords. Ties go to the earlier definition.
 */
export function matchStarter(prompt: string, defs: readonly WidgetDef[]): StarterMatch | null {
  const text = prompt.toLowerCase();
  let best: StarterMatch | null = null;
  for (const def of defs) {
    let score = 0;
    const seen = new Set<string>();
    const terms: Array<[string, number]> = [
      [def.type, 2],
      [def.title, 2],
      ...def.keywords.map((keyword): [string, number] => [keyword, 1]),
    ];
    for (const [term, weight] of terms) {
      const key = term.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (occurrences(text, key) > 0) score += weight * key.split(/\s+/).length;
    }
    if (score > 0 && (!best || score > best.score)) best = { def, score };
  }
  return best;
}

export function starterCreatedReply(def: WidgetDef): string {
  return (
    `I added the "${def.starter.title}" starter template. No AI is connected to this space, ` +
    "so this is a ready-made template rather than a custom tool. Add an AI key in the settings " +
    "to have tools built and changed to fit your request."
  );
}

export function noStarterReply(defs: readonly WidgetDef[]): string {
  const intro =
    "No AI is connected to this space, so I can only add ready-made starter templates. " +
    "Add an AI key in the settings to have custom tools built for you.";
  if (defs.length === 0) return intro;
  const list = defs.map((def) => `- ${def.title}: ${def.description}`).join("\n");
  return `${intro}\n\nAvailable starters:\n${list}`;
}

export function noAiChangeReply(): string {
  return (
    "Changing a tool needs an AI, and none is connected to this space. " +
    "Add an AI key in the settings and ask again."
  );
}
