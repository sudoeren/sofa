import { listTools, toolsMap } from "@sofa/shared";
import { ArrowUp, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { Avatar } from "../../components/Avatar";
import { useTheme } from "../../lib/theme";
import { ToolView } from "../../runtime";
import {
  addTool,
  BEFORE_WE_FLY,
  DEMO_ME,
  DEMO_MEMBERS,
  LISBON_EXPENSES,
  newDemoDoc,
  patchToolRecord,
  setToolState,
  vote,
  widgetRecord,
} from "./demo";

const PROMPT = "Split the costs between the four of us, in euros";

type Phase = "idle" | "typing" | "building" | "done";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function seed(doc: Y.Doc, withExpenses: boolean): void {
  addTool(doc, widgetRecord("demo-poll", "poll", { order: 1 }));
  addTool(
    doc,
    widgetRecord("demo-todo", "checklist", {
      order: 2,
      title: "Before we fly",
      config: BEFORE_WE_FLY,
    }),
  );
  if (withExpenses) {
    addTool(
      doc,
      widgetRecord("demo-costs", "expenses", {
        order: 3,
        title: "Lisbon costs",
        config: LISBON_EXPENSES,
      }),
    );
  }
}

function useToolIds(doc: Y.Doc): string[] {
  const map = toolsMap(doc);
  const subscribe = (fn: () => void) => {
    map.observe(fn);
    return () => map.unobserve(fn);
  };
  const key = useSyncExternalStore(subscribe, () =>
    listTools(doc)
      .map((t) => t.id)
      .join(","),
  );
  return key ? key.split(",") : [];
}

/**
 * A scripted, fully local space: the same tool components as the real app, running on an
 * in-memory document. Other members "act" on a timer so the preview shows live editing.
 */
export function DemoSpace() {
  const { theme } = useTheme();
  const [run, setRun] = useState(0);
  const reduced = useMemo(prefersReducedMotion, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new run starts a fresh document
  const doc = useMemo(() => {
    const d = newDemoDoc();
    seed(d, reduced);
    return d;
  }, [run, reduced]);
  const ids = useToolIds(doc);
  const gridRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(reduced ? PROMPT : "");
  const [phase, setPhase] = useState<Phase>(reduced ? "done" : "idle");
  const [present, setPresent] = useState(reduced ? DEMO_MEMBERS : DEMO_MEMBERS.slice(0, 2));
  // on phones the cards scroll sideways: bring the new tool into view when it arrives
  useEffect(() => {
    const grid = gridRef.current;
    if (phase !== "building" || !grid || grid.scrollWidth <= grid.clientWidth) return;
    grid.scrollTo({ left: grid.scrollWidth, behavior: "smooth" });
  }, [phase]);

  useEffect(() => {
    if (reduced) return;
    setTyped("");
    setPhase("idle");
    setPresent(DEMO_MEMBERS.slice(0, 2));
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const ada = DEMO_MEMBERS[1];
    const deniz = DEMO_MEMBERS[2];
    const mert = DEMO_MEMBERS[3];
    if (!ada || !deniz || !mert) return;

    at(900, () => setToolState(doc, "demo-poll", `vote:${ada.id}`, vote(ada, ["meze"])));
    at(1600, () => setPresent(DEMO_MEMBERS.slice(0, 3)));
    at(2200, () => setToolState(doc, "demo-poll", `vote:${deniz.id}`, vote(deniz, ["ramen"])));
    at(1300, () =>
      setToolState(doc, "demo-todo", "done:flat", { by: ada.id, name: ada.name, at: Date.now() }),
    );
    at(2000, () =>
      setToolState(doc, "demo-todo", "claim:sintra", {
        id: deniz.id,
        name: deniz.name,
        color: deniz.color,
      }),
    );
    at(2600, () => setPhase("typing"));
    for (let i = 1; i <= PROMPT.length; i++) {
      at(2600 + i * 34, () => setTyped(PROMPT.slice(0, i)));
    }
    const sent = 2600 + PROMPT.length * 34 + 450;
    at(sent, () => {
      setTyped("");
      setPhase("building");
      addTool(
        doc,
        widgetRecord("demo-costs", "expenses", {
          order: 3,
          title: "New tool",
          status: "generating",
          config: LISBON_EXPENSES,
        }),
      );
    });
    at(sent + 1700, () => {
      patchToolRecord(doc, "demo-costs", { status: "ready", title: "Lisbon costs" });
      setPhase("done");
    });
    at(sent + 2300, () => setPresent(DEMO_MEMBERS));
    at(sent + 3000, () => setToolState(doc, "demo-poll", `vote:${mert.id}`, vote(mert, ["meze"])));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [doc, reduced]);

  return (
    <section className="demo" aria-label="Interactive preview of a Sofa space">
      <div className="demo-meta">
        <div className="demo-presence">
          <div className="demo-avatars">
            {present.map((m) => (
              <span key={m.id} className="demo-avatar">
                <Avatar member={m} />
              </span>
            ))}
          </div>
          <span className="demo-live">
            <span className="demo-live-dot" />
            {present.length} people here
          </span>
        </div>
        <button type="button" className="demo-replay" onClick={() => setRun((n) => n + 1)}>
          <RotateCcw size={13} aria-hidden="true" />
          <span>Replay</span>
        </button>
      </div>
      <div className="demo-grid" ref={gridRef}>
        {ids.map((id) => (
          <DemoCard key={id} doc={doc} id={id} theme={theme} />
        ))}
      </div>
      <div className="demo-prompt">
        <div className={phase === "typing" ? "demo-input is-typing" : "demo-input"}>
          {typed ? (
            <span>{typed}</span>
          ) : (
            <span className="demo-placeholder">
              {phase === "building" ? "Building a tool..." : "Ask for a poll, a plan, a bracket"}
            </span>
          )}
          <span className="demo-send" aria-hidden="true">
            <ArrowUp size={14} />
          </span>
        </div>
      </div>
    </section>
  );
}

function DemoCard({ doc, id, theme }: { doc: Y.Doc; id: string; theme: "light" | "dark" }) {
  const title = useSyncExternalStore(
    (fn) => {
      const tool = toolsMap(doc).get(id);
      tool?.observe(fn);
      return () => tool?.unobserve(fn);
    },
    () => String(toolsMap(doc).get(id)?.get("title") ?? ""),
  );
  return (
    <section className="demo-card">
      <header className="demo-card-head">{title}</header>
      <div className="demo-card-body">
        <ToolView doc={doc} toolId={id} me={DEMO_ME} members={DEMO_MEMBERS} theme={theme} />
      </div>
    </section>
  );
}
