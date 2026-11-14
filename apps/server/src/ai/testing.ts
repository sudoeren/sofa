import {
  type ChatMessage,
  chatArray,
  type GenerateBody,
  listTools,
  metaMap,
  readToolState,
  type ToolRecord,
  type ToolState,
  toolsMap,
} from "@sofra/shared";
import type { WidgetDef } from "@sofra/widgets";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import * as Y from "yjs";
import { z } from "zod";
import type { Config } from "../config";
import type { FileStore, SpaceDocs } from "../types";

/** Test helpers for the AI service: in-memory documents, files, widgets and model scripts. */

export const SPACE = "space0000000000000001";

export function fakeDocs(
  spaceIds: string[] = [SPACE],
): SpaceDocs & { doc(spaceId?: string): Y.Doc } {
  const docs = new Map<string, Y.Doc>();
  for (const id of spaceIds) {
    const doc = new Y.Doc();
    metaMap(doc).set("title", "Lisbon trip");
    docs.set(id, doc);
  }
  const get = (spaceId: string): Y.Doc => {
    const doc = docs.get(spaceId);
    if (!doc) throw new Error("space not found");
    return doc;
  };
  return {
    async transact(spaceId, fn) {
      const doc = get(spaceId);
      return doc.transact(() => fn(doc));
    },
    async read(spaceId, fn) {
      return fn(get(spaceId));
    },
    doc: (spaceId = SPACE) => get(spaceId),
  };
}

export function fakeFiles(
  texts: Record<string, string> = {},
): FileStore & { reads: Array<[string, number]> } {
  const reads: Array<[string, number]> = [];
  return {
    reads,
    get: () => null,
    async readText(fileId, maxBytes) {
      reads.push([fileId, maxBytes]);
      const text = texts[fileId];
      if (text === undefined) return null;
      return Buffer.byteLength(text, "utf8") <= maxBytes ? text : text.slice(0, maxBytes);
    },
  };
}

export function testConfig(ai: Partial<Config["ai"]> = {}): Config {
  return {
    port: 0,
    dataDir: "/tmp/none",
    publicUrl: null,
    webDir: "/tmp/none",
    spaceTtlHours: 0,
    ai: { provider: "none", model: "", apiKey: null, baseUrl: null, ...ai },
  };
}

const voteConfig = z.object({
  question: z.string().min(1),
  options: z.array(z.object({ id: z.string(), label: z.string().min(1) })).min(2),
  multiple: z.boolean().default(false),
});

export const voteWidget: WidgetDef<z.infer<typeof voteConfig>> = {
  type: "vote",
  title: "Vote",
  description: "Ask a question and let everyone pick an answer.",
  guide: "Use for choosing between options. State: vote:<memberId> = option id.",
  configSchema: voteConfig,
  starter: {
    title: "Quick vote",
    description: "A simple vote",
    config: {
      question: "What do you think?",
      options: [
        { id: "a", label: "Yes" },
        { id: "b", label: "No" },
      ],
      multiple: false,
    },
    initialState: { "note:intro": "starter" },
  },
  keywords: ["poll", "vote", "choose"],
};

const tasksConfig = z.object({ heading: z.string(), items: z.array(z.string()).default([]) });

export const tasksWidget: WidgetDef<z.infer<typeof tasksConfig>> = {
  type: "tasks",
  title: "Task list",
  description: "A shared list of things to do.",
  guide: "Use for to-do and packing lists. State: done:<itemIndex> = true.",
  configSchema: tasksConfig,
  starter: { title: "To do", description: "Things to do", config: { heading: "To do", items: [] } },
  keywords: ["checklist", "todo", "packing list"],
};

export const testWidgets: WidgetDef<any>[] = [voteWidget, tasksWidget];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export type ScriptItem = { text: string } | { call: string; input: unknown };
export type ScriptStep =
  | ScriptItem[]
  | { finish: "length" | "content-filter"; items?: ScriptItem[] };

/** One model call as the stream chunks a provider would emit. */
function streamFor(step: ScriptStep, index: number) {
  const items = Array.isArray(step) ? step : (step.items ?? []);
  const chunks: any[] = [{ type: "stream-start", warnings: [] }];
  let calls = 0;
  items.forEach((item, itemIndex) => {
    if ("text" in item) {
      const id = `text-${index}-${itemIndex}`;
      chunks.push(
        { type: "text-start", id },
        { type: "text-delta", id, delta: item.text },
        { type: "text-end", id },
      );
    } else {
      calls++;
      const id = `call-${index}-${itemIndex}`;
      const input = JSON.stringify(item.input);
      chunks.push(
        { type: "tool-input-start", id, toolName: item.call },
        { type: "tool-input-delta", id, delta: input },
        { type: "tool-input-end", id },
        { type: "tool-call", toolCallId: id, toolName: item.call, input },
      );
    }
  });
  const unified = Array.isArray(step) ? (calls > 0 ? "tool-calls" : "stop") : step.finish;
  chunks.push({ type: "finish", finishReason: { unified, raw: undefined }, usage });
  return {
    stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
  };
}

/**
 * A model that answers each call with the next scripted step. `gate` (optional) is
 * awaited before every call, so tests can hold a generation open.
 */
export function scriptedModel(
  steps: ScriptStep[],
  gate?: (callIndex: number) => Promise<void>,
): MockLanguageModelV4 {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const current = index++;
      if (gate) await gate(current);
      const step = steps[current];
      if (!step)
        throw new Error(
          `the model was called ${current + 1} times but only ${steps.length} steps are scripted`,
        );
      return streamFor(step, current);
    },
  });
}

/** Text of everything sent to the model in one call. */
export function promptText(model: MockLanguageModelV4, call = 0): string {
  return JSON.stringify(model.doStreamCalls[call]?.prompt ?? null);
}

export function body(prompt: string, extra: Partial<GenerateBody> = {}): GenerateBody {
  return { prompt, user: { id: "u1", name: "Ada" }, ...extra };
}

export function chat(doc: Y.Doc): ChatMessage[] {
  return chatArray(doc).toArray();
}

export function tools(doc: Y.Doc): ToolRecord[] {
  return listTools(doc);
}

export function stateOf(doc: Y.Doc, toolId: string): ToolState {
  const tool = toolsMap(doc).get(toolId);
  return tool ? readToolState(tool) : {};
}

/** Wait until the assistant message has left "pending". */
export async function settled(
  doc: Y.Doc,
  messageId: string,
  timeoutMs = 4000,
): Promise<ChatMessage> {
  const start = Date.now();
  for (;;) {
    const message = chat(doc).find((m) => m.id === messageId);
    if (message && message.status !== "pending") {
      // The queue releases the space one tick after the final write.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return message;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`message ${messageId} is still pending`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const GOOD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Dice</title>
<style>body { font-family: var(--font); color: var(--text); }</style></head>
<body><button id="roll" type="button">Roll</button><div id="out"></div>
<script>
function render() { document.getElementById("out").textContent = String(sofra.state.get("roll:last") || ""); }
document.getElementById("roll").onclick = function () { sofra.state.set("roll:last", 1 + Math.floor(Math.random() * 6)); };
sofra.ready(function () { render(); sofra.state.subscribe(render); });
</script></body></html>`;

export const EXTERNAL_SCRIPT_HTML = GOOD_HTML.replace(
  "<script>",
  '<script src="https://cdn.example.com/lib.js"></script><script>',
);
