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
      SOFA_AI_PROVIDER: "openrouter",
      SOFA_AI_MODEL: "google/gemini-3.1-pro-preview",
      ANTHROPIC_API_KEY: "a-key",
      OPENROUTER_API_KEY: "sk-or-1",
    });
    expect(config.ai).toMatchObject({
      provider: "openrouter",
      model: "google/gemini-3.1-pro-preview",
    });
  });

  it("falls back to none when OpenRouter is chosen without a key", () => {
    expect(loadConfig({ SOFA_AI_PROVIDER: "openrouter" }).ai.provider).toBe("none");
  });

  it("reads the demo flag", () => {
    expect(loadConfig({}).demo).toBe(false);
    expect(loadConfig({ SOFA_DEMO: "1" }).demo).toBe(true);
    expect(loadConfig({ SOFA_DEMO: "true" }).demo).toBe(true);
    expect(loadConfig({ SOFA_DEMO: "0" }).demo).toBe(false);
  });

  it("reads the analytics script only when both values are valid", () => {
    expect(loadConfig({}).analytics).toBeNull();
    expect(
      loadConfig({
        SOFA_ANALYTICS_SRC: "https://stats.example.com/script.js",
        SOFA_ANALYTICS_WEBSITE_ID: "552bc978-ac65-424b",
      }).analytics,
    ).toEqual({ src: "https://stats.example.com/script.js", websiteId: "552bc978-ac65-424b" });
    expect(
      loadConfig({ SOFA_ANALYTICS_SRC: "https://stats.example.com/s.js" }).analytics,
    ).toBeNull();
    expect(
      loadConfig({ SOFA_ANALYTICS_SRC: "javascript:alert(1)", SOFA_ANALYTICS_WEBSITE_ID: "abc" })
        .analytics,
    ).toBeNull();
    expect(
      loadConfig({
        SOFA_ANALYTICS_SRC: "https://stats.example.com/s.js",
        SOFA_ANALYTICS_WEBSITE_ID: '"><script>',
      }).analytics,
    ).toBeNull();
  });
});
