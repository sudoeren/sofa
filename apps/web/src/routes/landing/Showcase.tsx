import { WIDGET_DEFS } from "@sofa/widgets";
import { useMemo, useState } from "react";
import { useTheme } from "../../lib/theme";
import { ToolView } from "../../runtime";
import {
  addTool,
  DEMO_ME,
  DEMO_MEMBERS,
  htmlRecord,
  newDemoDoc,
  PICKLE_HTML,
  setToolState,
  vote,
  widgetRecord,
} from "./demo";

type Entry = { id: string; label: string; prompt: string; blurb: string };

const PROMPTS: Record<string, string> = {
  poll: "A poll for Friday dinner with four places",
  checklist: "What do we still need to sort out for the cabin?",
  availability: "Which evening next week works for everyone?",
  table: "Who brings which dish to the potluck",
  expenses: "Split the trip costs between the four of us",
  itinerary: "Three days in Lisbon, mornings and evenings",
  bracket: "A bracket for the office table tennis cup",
  seating: "Seat the guests for the anniversary dinner",
};

const ENTRIES: Entry[] = [
  ...WIDGET_DEFS.map((def) => ({
    id: def.type,
    label: def.title,
    prompt: PROMPTS[def.type] ?? def.starter.title,
    blurb: def.description,
  })),
  {
    id: "custom",
    label: "Anything else",
    prompt: "A tiny game where you catch a pickle, with a shared scoreboard",
    blurb: "When no built-in tool fits, the AI writes one. It runs in a sandbox with no network.",
  },
];

function buildDoc(id: string) {
  const doc = newDemoDoc();
  if (id === "custom") {
    addTool(doc, htmlRecord("show", "Catch the pickle", PICKLE_HTML), {
      "score:demo-ada": { name: "Ada", n: 7 },
      "score:demo-deniz": { name: "Deniz", n: 4 },
    });
    return doc;
  }
  const def = WIDGET_DEFS.find((d) => d.type === id);
  addTool(doc, widgetRecord("show", id), def?.starter.initialState ?? {});
  if (id === "poll") {
    const [, ada, deniz] = DEMO_MEMBERS;
    if (ada) setToolState(doc, "show", `vote:${ada.id}`, vote(ada, ["meze"]));
    if (deniz) setToolState(doc, "show", `vote:${deniz.id}`, vote(deniz, ["pizza"]));
  }
  return doc;
}

/** Every built-in tool, live, with the request that would create it. */
export function Showcase() {
  const { theme } = useTheme();
  const [active, setActive] = useState(ENTRIES[0]?.id ?? "poll");
  const doc = useMemo(() => buildDoc(active), [active]);
  const entry = ENTRIES.find((e) => e.id === active) ?? ENTRIES[0];

  return (
    <div className="showcase">
      <div className="showcase-tabs" role="tablist" aria-label="Tools">
        {ENTRIES.map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            id={`tab-${e.id}`}
            aria-selected={e.id === active}
            aria-controls="showcase-panel"
            className="showcase-tab"
            onClick={() => setActive(e.id)}
          >
            {e.label}
          </button>
        ))}
      </div>
      <div
        className="showcase-panel"
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
      >
        <div className="showcase-copy">
          <p className="showcase-ask">
            <span className="showcase-ask-label">Ask</span>
            {entry?.prompt}
          </p>
          <p className="showcase-blurb">{entry?.blurb}</p>
          <p className="showcase-note">This preview is live. Try it.</p>
        </div>
        <div className="showcase-tool" key={active}>
          <ToolView doc={doc} toolId="show" me={DEMO_ME} members={DEMO_MEMBERS} theme={theme} />
        </div>
      </div>
    </div>
  );
}
