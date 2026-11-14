import {
  type ChatMessage,
  type ChatStatus,
  chatArray,
  type GenerateBody,
  type JsonValue,
  newId,
  nextToolOrder,
  patchChatMessage,
  putTool,
} from "@sofra/shared";
import type { WidgetDef } from "@sofra/widgets";
import { isStepCount, type LanguageModel, streamText } from "ai";
import type { Config } from "../config";
import type { AiDeps, AiService } from "../types";
import { buildRequestMessage, type ContextBudget, clip, snapshotSpace } from "./context";
import { matchStarter, noAiChangeReply, noStarterReply, starterCreatedReply } from "./fallback";
import { buildSystemPrompt } from "./prompt";
import {
  createLanguageModel,
  describeFailure,
  maxOutputTokensFor,
  type ProviderChoice,
  redactSecrets,
  resolveProvider,
  serverInfo,
} from "./provider";
import { buildModelTools, GenerationSession, type ToolChange } from "./session";

export type AiServiceOptions = {
  /** the widget catalog; index.ts passes WIDGET_DEFS */
  widgets: readonly WidgetDef[];
  /** replaces the real provider clients, for tests */
  createModel?: (choice: ProviderChoice) => LanguageModel;
  /** whole generation, from the moment it leaves the queue */
  timeoutMs?: number;
  /** running plus waiting generations per space */
  maxQueue?: number;
  budget?: ContextBudget;
  log?: (line: string) => void;
  now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_MAX_QUEUE = 6;
/** model calls per request: tool calls, corrections after rejected calls, final reply */
const MAX_STEPS = 6;
const MAX_REPLY_CHARS = 2000;

type Outcome = { status: ChatStatus; text: string };
type Queue = { tail: Promise<void>; size: number };

function timeoutError(): Error {
  const error = new Error("The generation timed out.");
  error.name = "TimeoutError";
  return error;
}

function summarize(changes: ToolChange[]): string {
  const phrase = (change: ToolChange) =>
    `${change.action === "created" ? "created" : change.action === "converted" ? "rebuilt" : "updated"} "${change.title}"`;
  return changes.map(phrase).join(", ");
}

export function createAiServiceWith(
  config: Config,
  deps: AiDeps,
  options: AiServiceOptions,
): AiService {
  const widgets = options.widgets;
  const createModel = options.createModel ?? createLanguageModel;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  const now = options.now ?? Date.now;
  const queues = new Map<string, Queue>();
  let systemPrompt: string | null = null;

  /** Log lines never carry request bodies or error objects, only sanitized text. */
  function log(line: string, secrets: Array<string | null | undefined> = []): void {
    const safe = redactSecrets(line, [config.ai.apiKey, ...secrets]);
    if (options.log) options.log(safe);
    else console.error(`[ai] ${safe}`);
  }

  function getSystemPrompt(): string {
    systemPrompt ??= buildSystemPrompt(widgets);
    return systemPrompt;
  }

  async function runStarter(
    spaceId: string,
    body: GenerateBody,
    session: GenerationSession,
  ): Promise<Outcome> {
    if (body.toolId) return { status: "done", text: noAiChangeReply() };
    const match = matchStarter(body.prompt, widgets);
    if (!match) return { status: "done", text: noStarterReply(widgets) };
    const def = match.def;
    await deps.docs.transact(spaceId, (doc) => {
      const id = newId();
      const time = now();
      putTool(
        doc,
        {
          id,
          title: def.starter.title,
          description: def.starter.description,
          kind: "widget",
          widgetType: def.type,
          config: def.starter.config as JsonValue,
          html: "",
          status: "ready",
          version: 1,
          order: nextToolOrder(doc),
          span: 1,
          createdBy: body.user.id,
          createdAt: time,
          updatedAt: time,
        },
        def.starter.initialState ?? {},
      );
      session.changes.push({ toolId: id, title: def.starter.title, action: "created" });
    });
    return { status: "done", text: starterCreatedReply(def) };
  }

  async function runModel(
    spaceId: string,
    body: GenerateBody,
    choice: ProviderChoice,
    session: GenerationSession,
    skipMessageIds: string[],
    signal: AbortSignal,
  ): Promise<Outcome> {
    const snapshot = await deps.docs.read(spaceId, (doc) =>
      snapshotSpace(doc, body.toolId, skipMessageIds),
    );
    if (body.toolId && snapshot.target) await session.markBusy(body.toolId);

    const request = await buildRequestMessage({
      snapshot,
      prompt: body.prompt,
      userName: body.user.name,
      toolId: body.toolId,
      files: deps.files,
      budget: options.budget,
    });
    signal.throwIfAborted();

    const result = streamText({
      model: createModel(choice),
      instructions: {
        role: "system",
        content: getSystemPrompt(),
        // The prompt is identical for every request, so let the provider cache it.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      prompt: request.text,
      tools: buildModelTools(session, widgets),
      toolCallConcurrency: 1,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: maxOutputTokensFor(choice),
      maxRetries: 1,
      abortSignal: signal,
      // The default handler prints the raw error object; ours are reported sanitized below.
      onError: () => {},
    });

    let stepText = "";
    let reply = "";
    let finishReason = "unknown";
    for await (const part of result.stream) {
      if (part.type === "start-step") {
        stepText = "";
      } else if (part.type === "text-delta") {
        stepText += part.text;
      } else if (part.type === "finish-step") {
        if (stepText.trim()) reply = stepText;
        finishReason = part.finishReason;
      } else if (part.type === "error") {
        throw part.error;
      } else if (part.type === "abort") {
        throw signal.aborted ? signal.reason : new Error("The generation was aborted.");
      }
    }
    signal.throwIfAborted();

    const text = clip(reply.trim(), MAX_REPLY_CHARS);
    const done = session.changes.length > 0;
    if (finishReason === "length") {
      return {
        status: "error",
        text: done
          ? `The answer was cut off, but I ${summarize(session.changes)}. Ask again for anything that is missing.`
          : "The tool turned out too large to finish. Ask for something simpler, or split it into smaller tools.",
      };
    }
    if (finishReason === "content-filter") {
      return {
        status: "error",
        text: "The AI provider declined this request. Try wording it differently.",
      };
    }
    if (text) return { status: "done", text };
    if (done) return { status: "done", text: `Done: I ${summarize(session.changes)}.` };
    if (session.failedCalls > 0) {
      return {
        status: "error",
        text: "I could not build a working tool for this request. Try again, or describe it a little differently.",
      };
    }
    return {
      status: "error",
      text: "The AI gave no answer. Try again, or describe what you need differently.",
    };
  }

  async function runJob(
    spaceId: string,
    body: GenerateBody,
    userMessageId: string,
    assistantId: string,
  ): Promise<void> {
    const choice = resolveProvider(config, body.ai);
    const secrets = [body.ai?.apiKey];
    const session = new GenerationSession({
      spaceId,
      docs: deps.docs,
      widgets,
      user: body.user,
      budget: options.budget,
      now,
      onProgress: async (text) => {
        await deps.docs.transact(spaceId, (doc) => {
          const current = chatArray(doc)
            .toArray()
            .find((message) => message.id === assistantId);
          if (current?.status === "pending" && current.text !== text)
            patchChatMessage(doc, assistantId, { text });
        });
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
    let outcome: Outcome;
    try {
      if (!choice) {
        outcome = await runStarter(spaceId, body, session);
      } else {
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        });
        const work = runModel(
          spaceId,
          body,
          choice,
          session,
          [userMessageId, assistantId],
          controller.signal,
        );
        // When the timeout wins the race the stream may still fail later; that is expected.
        work.catch(() => {});
        outcome = await Promise.race([work, aborted]);
      }
    } catch (error) {
      const failure = describeFailure(error, choice, [config.ai.apiKey, ...secrets]);
      log(`generation failed in space ${spaceId.slice(0, 6)}: ${failure.log}`, secrets);
      const kept =
        session.changes.length > 0 ? ` Before that I ${summarize(session.changes)}.` : "";
      outcome = { status: "error", text: `${failure.chat}${kept}` };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    const text = redactSecrets(outcome.text, [config.ai.apiKey, ...secrets]);
    const patch: Partial<ChatMessage> = { text, status: outcome.status };
    const firstTool = session.changes[0]?.toolId;
    if (firstTool) patch.toolId = firstTool;
    try {
      await deps.docs.transact(spaceId, (doc) => {
        session.finishIn(doc);
        patchChatMessage(doc, assistantId, patch);
      });
    } catch (error) {
      log(
        `could not finish generation in space ${spaceId.slice(0, 6)}: ${describeFailure(error, choice, secrets).log}`,
        secrets,
      );
      // Second attempt, split up, so one failing half cannot block the other.
      await deps.docs.transact(spaceId, (doc) => session.finishIn(doc)).catch(() => {});
      await deps.docs
        .transact(spaceId, (doc) =>
          patchChatMessage(doc, assistantId, { text, status: outcome.status }),
        )
        .catch(() => {});
    }
  }

  return {
    enabled: config.ai.provider !== "none",
    info: () => serverInfo(config),

    async generate(spaceId, body) {
      const userMessageId = newId();
      const assistantId = newId();
      const queue = queues.get(spaceId) ?? { tail: Promise.resolve(), size: 0 };
      const full = queue.size >= maxQueue;
      const time = now();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        text: body.prompt,
        authorId: body.user.id,
        authorName: body.user.name,
        status: "done",
        createdAt: time,
      };
      if (body.toolId) userMessage.toolId = body.toolId;
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: full
          ? "Too many requests are waiting in this space. Wait for them to finish, then ask again."
          : "",
        status: full ? "error" : "pending",
        createdAt: time + 1,
      };

      try {
        await deps.docs.transact(spaceId, (doc) => {
          chatArray(doc).push([userMessage, assistantMessage]);
        });
      } catch (error) {
        log(
          `could not append chat messages: ${describeFailure(error, null, [body.ai?.apiKey]).log}`,
          [body.ai?.apiKey],
        );
        return { messageId: assistantId };
      }
      if (full) return { messageId: assistantId };

      queue.size++;
      queues.set(spaceId, queue);
      queue.tail = queue.tail
        .then(() => runJob(spaceId, body, userMessageId, assistantId))
        .catch((error) => {
          log(`generation crashed: ${describeFailure(error, null, [body.ai?.apiKey]).log}`, [
            body.ai?.apiKey,
          ]);
        })
        .finally(() => {
          queue.size--;
          if (queue.size === 0 && queues.get(spaceId) === queue) queues.delete(spaceId);
        });
      return { messageId: assistantId };
    },
  };
}
