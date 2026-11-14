import path from "node:path";

export type AiProvider = "anthropic" | "openai" | "openrouter" | "openai-compatible" | "none";

export type Config = {
  port: number;
  dataDir: string;
  publicUrl: string | null;
  /** directory with the built web app, served when it exists */
  webDir: string;
  /** delete spaces untouched for this many hours; 0 keeps them forever */
  spaceTtlHours: number;
  ai: {
    provider: AiProvider;
    model: string;
    apiKey: string | null;
    baseUrl: string | null;
  };
};

const DEFAULT_MODELS: Record<Exclude<AiProvider, "none">, string> = {
  anthropic: "claude-fable-5-2",
  openai: "gpt-5",
  openrouter: "anthropic/claude-haiku-5.5",
  "openai-compatible": "qwen3-coder",
};

function parseProvider(value: string | undefined, env: NodeJS.ProcessEnv): AiProvider {
  const v = (value ?? "").trim().toLowerCase();
  if (
    v === "anthropic" ||
    v === "openai" ||
    v === "openrouter" ||
    v === "openai-compatible" ||
    v === "none"
  )
    return v;
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.SOFRA_AI_BASE_URL) return "openai-compatible";
  return "none";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let provider = parseProvider(env.SOFRA_AI_PROVIDER, env);
  let apiKey: string | null = null;
  let baseUrl: string | null = null;
  if (provider === "anthropic") apiKey = env.ANTHROPIC_API_KEY || null;
  if (provider === "openai") apiKey = env.OPENAI_API_KEY || null;
  if (provider === "openrouter") apiKey = env.OPENROUTER_API_KEY || null;
  if (provider === "openai-compatible") {
    apiKey = env.SOFRA_AI_API_KEY || null;
    baseUrl = env.SOFRA_AI_BASE_URL || null;
    if (!baseUrl) provider = "none";
  }
  // A hosted provider without a key cannot work; fall back to templates only.
  if ((provider === "anthropic" || provider === "openai" || provider === "openrouter") && !apiKey)
    provider = "none";

  return {
    port: Number(env.PORT) || 8787,
    dataDir: path.resolve(env.SOFRA_DATA_DIR || "./data"),
    publicUrl: env.SOFRA_PUBLIC_URL?.replace(/\/+$/, "") || null,
    spaceTtlHours: Math.max(0, Number(env.SOFRA_SPACE_TTL_HOURS) || 0),
    webDir: path.resolve(env.SOFRA_WEB_DIR || path.join(import.meta.dirname, "../../web/dist")),
    ai: {
      provider,
      model: env.SOFRA_AI_MODEL || (provider === "none" ? "" : DEFAULT_MODELS[provider]),
      apiKey,
      baseUrl,
    },
  };
}
