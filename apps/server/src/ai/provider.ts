import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { OPENROUTER_BASE_URL, type UserAi } from "@sofa/shared";
import type { LanguageModel } from "ai";
import type { Config } from "../config";
import type { AiInfo } from "../types";

/**
 * Which provider a request runs on. The api key lives only in this object for the
 * duration of one request; it is never written to the document or to logs.
 */
export type ProviderChoice = {
  source: "member" | "server";
  provider: "anthropic" | "openai" | "openrouter" | "openai-compatible";
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
};

/** Defaults for a member key that names no model. */
const MEMBER_DEFAULT_MODELS = {
  anthropic: "claude-fable-5-2",
  openai: "gpt-5",
  openrouter: "anthropic/claude-haiku-5.5",
} as const;

export function serverInfo(config: Config): AiInfo | null {
  if (config.ai.provider === "none") return null;
  return { provider: config.ai.provider, model: config.ai.model };
}

/** The member's own key wins over the server configuration. Null means no AI at all. */
export function resolveProvider(config: Config, userAi: UserAi | undefined): ProviderChoice | null {
  if (userAi) {
    const sameAsServer = config.ai.provider === userAi.provider && config.ai.model;
    return {
      source: "member",
      provider: userAi.provider,
      model:
        userAi.model ?? (sameAsServer ? config.ai.model : MEMBER_DEFAULT_MODELS[userAi.provider]),
      apiKey: userAi.apiKey,
      baseUrl: null,
    };
  }
  if (config.ai.provider === "none") return null;
  return {
    source: "server",
    provider: config.ai.provider,
    model: config.ai.model,
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
  };
}

export function createLanguageModel(choice: ProviderChoice): LanguageModel {
  if (choice.provider === "anthropic") {
    return createAnthropic({ apiKey: choice.apiKey ?? undefined })(choice.model);
  }
  if (choice.provider === "openai") {
    return createOpenAI({ apiKey: choice.apiKey ?? undefined })(choice.model);
  }
  if (choice.provider === "openrouter") {
    return createOpenAICompatible({
      name: "openrouter",
      baseURL: OPENROUTER_BASE_URL,
      apiKey: choice.apiKey ?? undefined,
      // Optional attribution headers OpenRouter reads for its app listing.
      headers: { "HTTP-Referer": "https://github.com/sudoeren/sofa", "X-Title": "Sofa" },
    })(choice.model);
  }
  if (!choice.baseUrl) throw new Error("The OpenAI-compatible provider has no base URL.");
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: choice.baseUrl,
    apiKey: choice.apiKey ?? undefined,
  })(choice.model);
}

/** Output budget large enough for one full HTML document plus a reply. */
export function maxOutputTokensFor(choice: ProviderChoice): number {
  return choice.provider === "openai-compatible" ? 16_000 : 32_000;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\b(x-api-key|api[-_ ]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi,
];

/** Remove anything that could be a credential from text that goes to chat or logs. */
export function redactSecrets(
  text: string,
  secrets: Array<string | null | undefined> = [],
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
    // Providers often echo a shortened key ("sk-abc...wxyz"); cover head and tail too.
    if (secret.length >= 16) {
      out = out.split(secret.slice(0, 12)).join("[redacted]");
      out = out.split(secret.slice(-8)).join("[redacted]");
    }
  }
  out = out.replace(SECRET_PATTERNS[0] as RegExp, "[redacted]");
  out = out.replace(SECRET_PATTERNS[1] as RegExp, "Bearer [redacted]");
  out = out.replace(SECRET_PATTERNS[2] as RegExp, "$1$2[redacted]");
  return out;
}

function statusOf(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const status =
      (current as { statusCode?: unknown }).statusCode ?? (current as { status?: unknown }).status;
    if (typeof status === "number") return status;
    current =
      (current as { lastError?: unknown; cause?: unknown }).lastError ??
      (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    return "";
  }
}

export type Failure = {
  /** short text for the chat, safe to show to everyone in the space */
  chat: string;
  /** one sanitized line for the server log */
  log: string;
};

/** Turn any thrown value into text that cannot contain a key. */
export function describeFailure(
  error: unknown,
  choice: ProviderChoice | null,
  extraSecrets: Array<string | null | undefined> = [],
): Failure {
  const secrets = [choice?.apiKey, ...extraSecrets];
  const status = statusOf(error);
  const name = error instanceof Error ? error.name : "Error";
  const detail = redactSecrets(messageOf(error), secrets).replace(/\s+/g, " ").trim().slice(0, 240);
  const whose = choice?.source === "member" ? "your AI key" : "the AI key of this server";

  let chat: string;
  if (name === "TimeoutError" || /timed out|timeout/i.test(detail)) {
    chat = "This took too long and was stopped. Try again, or ask for something smaller.";
  } else if (name === "AbortError" || /abort/i.test(name)) {
    chat = "The request was stopped before it finished. Try again.";
  } else if (status === 401 || status === 403) {
    chat = `The AI provider rejected ${whose}. Check the key and the model name, then try again.`;
  } else if (status === 404) {
    chat = "The AI provider does not know this model. Check the model name in the AI settings.";
  } else if (status === 429) {
    chat = "The AI provider is rate limiting or out of credit right now. Try again in a moment.";
  } else if (status !== undefined && status >= 500) {
    chat = "The AI provider had a problem on its side. Try again in a moment.";
  } else if (status === 400 && detail) {
    chat = `The AI provider did not accept the request: ${detail}`;
  } else {
    chat = "The AI request failed. Nothing was changed; try again.";
  }
  return {
    chat: redactSecrets(chat, secrets),
    log: `${name}${status ? ` ${status}` : ""}: ${detail || "no detail"}`,
  };
}
