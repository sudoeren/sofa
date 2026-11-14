import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("picks OpenRouter from its key and uses its default model", () => {
    const config = loadConfig({ OPENROUTER_API_KEY: "sk-or-v1-12345678" });
    expect(config.ai).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude-haiku-5.5",
      apiKey: "sk-or-v1-12345678",
    });
  });

  it("prefers Anthropic and OpenAI keys when several are set", () => {
    expect(
      loadConfig({ ANTHROPIC_API_KEY: "a-key", OPENROUTER_API_KEY: "sk-or-1" }).ai.provider,
    ).toBe("anthropic");
    expect(loadConfig({ OPENAI_API_KEY: "o-key", OPENROUTER_API_KEY: "sk-or-1" }).ai.provider).toBe(
      "openai",
    );
  });

  it("honours an explicit provider and model", () => {
    const config = loadConfig({
      SOFRA_AI_PROVIDER: "openrouter",
      SOFRA_AI_MODEL: "google/gemini-3.1-pro-preview",
      ANTHROPIC_API_KEY: "a-key",
      OPENROUTER_API_KEY: "sk-or-1",
    });
    expect(config.ai).toMatchObject({
      provider: "openrouter",
      model: "google/gemini-3.1-pro-preview",
    });
  });

  it("falls back to none when OpenRouter is chosen without a key", () => {
    expect(loadConfig({ SOFRA_AI_PROVIDER: "openrouter" }).ai.provider).toBe("none");
  });
});
