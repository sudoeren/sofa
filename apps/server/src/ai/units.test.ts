import type { Material } from "@sofa/shared";
import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  buildRequestMessage,
  type ContextBudget,
  DEFAULT_BUDGET,
  type SpaceSnapshot,
} from "./context";
import { matchStarter } from "./fallback";
import { MAX_HTML_BYTES, validateToolHtml } from "./html";
import { buildSystemPrompt, describeConfigSchema, EXAMPLE_TOOL_HTML } from "./prompt";
import { createLanguageModel, describeFailure, redactSecrets, resolveProvider } from "./provider";
import { fakeFiles, GOOD_HTML, testConfig, testWidgets, voteWidget } from "./testing";

function material(patch: Partial<Material>): Material {
  return { id: "m", kind: "note", authorId: "u1", authorName: "Ada", createdAt: 1, ...patch };
}

function snapshot(materials: Material[]): SpaceSnapshot {
  return { title: "Lisbon trip", materials, tools: [], chat: [], target: null };
}

describe("context builder", () => {
  const materials = [
    material({ id: "n1", text: "Flights land on May 3 at 10:40." }),
    material({
      id: "l1",
      kind: "link",
      url: "https://example.com/hotel",
      title: "Hotel Alfama",
      description: "Rooms from 90 euro",
    }),
    material({
      id: "f1",
      kind: "file",
      fileId: "file-1",
      fileName: "budget.csv",
      mime: "text/csv",
      size: 40,
    }),
    material({
      id: "f2",
      kind: "file",
      fileId: "file-2",
      fileName: "photo.png",
      mime: "image/png",
      size: 99999,
    }),
  ];

  it("includes notes, links, file names and the text of text files", async () => {
    const files = fakeFiles({ "file-1": "item,cost\ntaxi,30", "file-2": "BINARY" });
    const built = await buildRequestMessage({
      snapshot: snapshot(materials),
      prompt: "plan it",
      userName: "Ada",
      toolId: undefined,
      files,
    });
    expect(built.text).toContain("<space_title>Lisbon trip</space_title>");
    expect(built.text).toContain("Flights land on May 3 at 10:40.");
    expect(built.text).toContain('url="https://example.com/hotel" title="Hotel Alfama"');
    expect(built.text).toContain("Rooms from 90 euro");
    expect(built.text).toContain('name="budget.csv"');
    expect(built.text).toContain("taxi,30");
    expect(built.text).toContain('name="photo.png"');
    expect(built.text).not.toContain("BINARY");
    expect(files.reads.map(([id]) => id)).toEqual(["file-1"]);
    expect(built.text.trimEnd().endsWith("</request>")).toBe(true);
    expect(built.omittedMaterials).toBe(0);
  });

  it("stays inside the materials budget and says what was left out", async () => {
    const budget: ContextBudget = { ...DEFAULT_BUDGET, materials: 1500, perMaterial: 600 };
    const many = Array.from({ length: 30 }, (_, i) =>
      material({ id: `n${i}`, text: `note ${i} ${"x".repeat(2000)}` }),
    );
    many.push(
      material({ id: "big", kind: "file", fileId: "big", fileName: "big.txt", mime: "text/plain" }),
    );
    const files = fakeFiles({ big: "y".repeat(50_000) });
    const built = await buildRequestMessage({
      snapshot: snapshot(many),
      prompt: "go",
      userName: "Ada",
      toolId: undefined,
      files,
      budget,
    });
    const inside = built.text.slice(
      built.text.indexOf("<materials>\n"),
      built.text.indexOf("\n</materials>"),
    );
    expect(inside.length).toBeLessThanOrEqual(1500 + 100);
    expect(inside).toContain("note 0");
    expect(inside).toContain("[truncated]");
    expect(built.omittedMaterials).toBeGreaterThan(0);
    expect(built.text).toContain("more materials did not fit");
    for (const [, maxBytes] of files.reads) expect(maxBytes).toBeLessThanOrEqual(600);
  });

  it("truncates the state snapshot of a target tool", async () => {
    const state: Record<string, string> = {};
    for (let i = 0; i < 500; i++) state[`item:${String(i).padStart(3, "0")}`] = "v".repeat(1000);
    const built = await buildRequestMessage({
      snapshot: {
        ...snapshot([]),
        target: {
          record: {
            id: "t1",
            title: "List",
            description: "",
            kind: "html",
            html: GOOD_HTML,
            status: "ready",
            version: 1,
            order: 1,
            span: 1,
            createdBy: "u1",
            createdAt: 1,
            updatedAt: 1,
          },
          state,
        },
      },
      prompt: "change",
      userName: "Ada",
      toolId: "t1",
      files: fakeFiles(),
    });
    const stateText = built.text.slice(
      built.text.indexOf("<tool_state>"),
      built.text.indexOf("</tool_state>"),
    );
    expect(stateText.length).toBeLessThanOrEqual(DEFAULT_BUDGET.targetState + 200);
    expect(stateText).toContain("item:000 = ");
    expect(stateText).toContain("more keys not shown (500 in total)");
    expect(built.text).toContain("sofa.state.get");
  });
});

describe("html validation", () => {
  const wrap = (inner: string) => GOOD_HTML.replace("<script>", `${inner}<script>`);

  it("accepts the reference documents without warnings", () => {
    expect(validateToolHtml(GOOD_HTML)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(validateToolHtml(EXAMPLE_TOOL_HTML)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("allows inline svg namespaces and data URIs", () => {
    const html = wrap(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg><img src="data:image/png;base64,AAAA">',
    );
    expect(validateToolHtml(html).ok).toBe(true);
  });

  it.each([
    ["script src", '<script src="lib.js"></script>'],
    ["external image", '<img src="https://example.com/a.png">'],
    ["protocol-relative link", "<link rel=stylesheet href=//cdn.example.com/a.css>"],
    ["css url", "<style>body { background: url('https://example.com/a.png'); }</style>"],
    ["css import", '<style>@import "theme.css";</style>'],
    ["js import", '<script type="module">import x from "https://esm.example.com/x.js";</script>'],
    ["dynamic import", '<script>import("//cdn.example.com/x.js");</script>'],
    [
      "src set from script",
      '<script>var i = new Image(); i.src = "https://example.com/t.gif";</script>',
    ],
    ["iframe", '<iframe srcdoc="x"></iframe>'],
  ])("rejects %s", (_name, inner) => {
    const result = validateToolHtml(wrap(inner));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects fragments and oversized documents", () => {
    expect(validateToolHtml("<div>hi</div>").ok).toBe(false);
    expect(validateToolHtml(GOOD_HTML.slice(0, GOOD_HTML.length - 20)).ok).toBe(false);
    const big = GOOD_HTML.replace("</body>", `<!-- ${"x".repeat(MAX_HTML_BYTES)} --></body>`);
    expect(validateToolHtml(big).errors.join(" ")).toContain("limit is 200 KB");
  });

  it("only warns about network calls, storage and emoji", () => {
    const result = validateToolHtml(
      wrap('<script>fetch("/x"); localStorage.a = 1; var s = "\u{1F600}";</script>'),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(3);
  });
});

describe("system prompt", () => {
  it("is deterministic and lists every widget with guide and schema", () => {
    const prompt = buildSystemPrompt(testWidgets);
    expect(buildSystemPrompt(testWidgets)).toBe(prompt);
    for (const def of testWidgets) {
      expect(prompt).toContain(`### ${def.type} (${def.title})`);
      expect(prompt).toContain(def.guide);
      expect(prompt).toContain(describeConfigSchema(def));
    }
    expect(JSON.parse(describeConfigSchema(voteWidget))).toMatchObject({
      type: "object",
      properties: { question: { type: "string" }, options: { type: "array", minItems: 2 } },
    });
    expect(prompt).toContain("sofa.state.subscribe");
    expect(prompt).toContain("--accent-soft");
    expect(prompt).toContain(EXAMPLE_TOOL_HTML);
    expect(prompt).toContain("no emoji");
    expect(prompt).toContain("language the member used");
    expect(/\p{Extended_Pictographic}/u.test(prompt)).toBe(false);
  });
});

describe("provider helpers", () => {
  it("resolves member key, then server config, then nothing", () => {
    const server = testConfig({
      provider: "openai-compatible",
      model: "local",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(resolveProvider(server, undefined)).toMatchObject({
      source: "server",
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(resolveProvider(server, { provider: "openai", apiKey: "sk-12345678" })).toMatchObject({
      source: "member",
      provider: "openai",
      model: "gpt-5",
      baseUrl: null,
    });
    expect(resolveProvider(testConfig(), undefined)).toBeNull();
    expect(
      resolveProvider(testConfig(), { provider: "openrouter", apiKey: "sk-or-v1-12345678" }),
    ).toMatchObject({
      source: "member",
      provider: "openrouter",
      model: "anthropic/claude-haiku-5.5",
    });
  });

  it("sends OpenRouter requests to its API with the key and attribution headers", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response(
        JSON.stringify({
          id: "r1",
          created: 1,
          model: "anthropic/claude-haiku-5.5",
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const model = createLanguageModel({
        source: "member",
        provider: "openrouter",
        model: "anthropic/claude-haiku-5.5",
        apiKey: "sk-or-v1-12345678",
        baseUrl: null,
      });
      const result = await generateText({ model, prompt: "hi" });
      expect(result.text).toBe("ok");
      expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-or-v1-12345678");
      expect(calls[0]?.headers.get("x-title")).toBe("Sofa");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds a client for each provider without any network call", () => {
    const base = { source: "server" as const, apiKey: "sk-test-12345678", baseUrl: null };
    const ids = [
      createLanguageModel({ ...base, provider: "anthropic", model: "claude-test" }),
      createLanguageModel({ ...base, provider: "openai", model: "gpt-test" }),
      createLanguageModel({ ...base, provider: "openrouter", model: "openai/gpt-5" }),
      createLanguageModel({
        ...base,
        provider: "openai-compatible",
        model: "local",
        apiKey: null,
        baseUrl: "http://localhost:11434/v1",
      }),
    ].map((model) => (typeof model === "string" ? model : model.modelId));
    expect(ids).toEqual(["claude-test", "gpt-test", "openai/gpt-5", "local"]);
    expect(() =>
      createLanguageModel({ ...base, provider: "openai-compatible", model: "local" }),
    ).toThrow("base URL");
  });

  it("redacts keys in any position", () => {
    const key = "zz-very-secret-key-0123456789";
    expect(
      redactSecrets(`failed with ${key} and Bearer abc.def.ghi-123 and sk-proj-abcdef123456`, [
        key,
      ]),
    ).toBe("failed with [redacted] and Bearer [redacted] and [redacted]");
    const failure = describeFailure(Object.assign(new Error(`nope ${key}`), { statusCode: 400 }), {
      source: "member",
      provider: "openai",
      model: "m",
      apiKey: key,
      baseUrl: null,
    });
    expect(failure.chat + failure.log).not.toContain(key);
  });
});

describe("starter matching", () => {
  it("is case-insensitive, whole-word and returns null without a match", () => {
    expect(matchStarter("VOTE now", testWidgets)?.def.type).toBe("vote");
    expect(matchStarter("a Checklist please", testWidgets)?.def.type).toBe("tasks");
    expect(matchStarter("devoted pollsters", testWidgets)).toBeNull();
    expect(matchStarter("something else entirely", testWidgets)).toBeNull();
  });
});
