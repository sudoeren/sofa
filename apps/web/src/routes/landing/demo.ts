import {
  colorFor,
  type JsonValue,
  type MemberInfo,
  putTool,
  type ToolRecord,
  type ToolState,
  toolStateMap,
  toolsMap,
} from "@sofra/shared";
import { getWidgetDef } from "@sofra/widgets";
import * as Y from "yjs";

/** Local, in-memory stand-ins for a real space. Nothing here talks to the server. */

function member(id: string, name: string): MemberInfo {
  return { id, name, color: colorFor(id) };
}

export const DEMO_ME = member("demo-you", "You");
export const DEMO_MEMBERS: MemberInfo[] = [
  DEMO_ME,
  member("demo-ada", "Ada"),
  member("demo-deniz", "Deniz"),
  member("demo-mert", "Mert"),
];

export function widgetRecord(
  id: string,
  widgetType: string,
  patch: Partial<ToolRecord> = {},
): ToolRecord {
  const def = getWidgetDef(widgetType);
  if (!def) throw new Error(`unknown widget ${widgetType}`);
  const now = Date.now();
  return {
    id,
    title: def.starter.title,
    description: def.starter.description,
    kind: "widget",
    widgetType,
    config: def.configSchema.parse(def.starter.config) as JsonValue,
    html: "",
    status: "ready",
    version: 1,
    order: 1,
    span: 1,
    createdBy: "demo",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function htmlRecord(id: string, title: string, html: string): ToolRecord {
  const now = Date.now();
  return {
    id,
    title,
    description: "",
    kind: "html",
    html,
    status: "ready",
    version: 1,
    order: 1,
    span: 1,
    createdBy: "demo",
    createdAt: now,
    updatedAt: now,
  };
}

export function addTool(doc: Y.Doc, record: ToolRecord, state: ToolState = {}): void {
  doc.transact(() => {
    putTool(doc, record, state);
  });
}

export function setToolState(doc: Y.Doc, toolId: string, key: string, value: JsonValue): void {
  const tool = toolsMap(doc).get(toolId);
  if (!tool) return;
  doc.transact(() => toolStateMap(tool).set(key, value));
}

export function patchToolRecord(doc: Y.Doc, toolId: string, patch: Partial<ToolRecord>): void {
  const tool = toolsMap(doc).get(toolId);
  if (!tool) return;
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) tool.set(key, value);
  });
}

export function vote(memberInfo: MemberInfo, choices: string[]): JsonValue {
  return { name: memberInfo.name, color: memberInfo.color, choices, at: Date.now() };
}

export const LISBON_EXPENSES = {
  currency: "EUR",
  people: DEMO_MEMBERS.map((m) => ({ id: m.id, name: m.name })),
  expenses: [
    { id: "flat", title: "Apartment in Alfama, 3 nights", amount: 420, paidBy: "demo-ada" },
    { id: "tram", title: "Tram and metro passes", amount: 48, paidBy: "demo-deniz" },
    { id: "fado", title: "Dinner and fado", amount: 136, paidBy: "demo-you" },
  ],
};

/** A small generated-looking tool that follows the frame SDK rules. */
export const PICKLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Catch the pickle</title>
<style>
  .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  h1{font-size:15px;margin:0}
  .hint{color:var(--muted);font-size:12px}
  .field{position:relative;height:170px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);overflow:hidden}
  .pickle{position:absolute;width:46px;height:22px;border:0;padding:0;border-radius:11px;background:#5a8f3a;cursor:pointer;transition:left .25s ease, top .25s ease}
  .pickle::after{content:"";position:absolute;inset:5px 8px;border-radius:6px;background:repeating-linear-gradient(90deg,transparent 0 6px,rgba(255,255,255,.18) 6px 8px)}
  ol{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:4px}
  li{display:flex;justify-content:space-between;font-size:13px}
  li b{font-variant-numeric:tabular-nums}
</style></head><body>
<div class="top"><h1>Catch the pickle</h1><span class="hint">tap it, it moves</span></div>
<div class="field" id="field"><button class="pickle" id="p" aria-label="Pickle"></button></div>
<ol id="board"></ol>
<script>
  var p = document.getElementById("p"), field = document.getElementById("field");
  function hop(){ var w = field.clientWidth - 46, h = field.clientHeight - 22;
    p.style.left = Math.round(Math.random() * w) + "px"; p.style.top = Math.round(Math.random() * h) + "px"; }
  function render(){
    var rows = sofra.state.entries("score:").map(function(e){ return e[1]; })
      .filter(function(v){ return v && typeof v.n === "number"; })
      .sort(function(a,b){ return b.n - a.n; }).slice(0, 4);
    document.getElementById("board").innerHTML = rows.map(function(r){
      var li = document.createElement("li"); var s = document.createElement("span"); s.textContent = r.name;
      var b = document.createElement("b"); b.textContent = r.n; li.appendChild(s); li.appendChild(b); return li.outerHTML; }).join("");
  }
  sofra.ready(function(){
    hop(); render(); sofra.state.subscribe(render);
    p.onclick = function(){ var k = "score:" + sofra.me.id; var cur = sofra.state.get(k);
      sofra.state.set(k, { name: sofra.me.name, n: (cur && cur.n || 0) + 1 }); hop(); };
  });
</script></body></html>`;

export function newDemoDoc(): Y.Doc {
  return new Y.Doc();
}
