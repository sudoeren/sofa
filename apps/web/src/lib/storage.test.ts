import { colorFor } from "@sofra/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAiSettings,
  clearSpaceToken,
  getSpaceToken,
  loadAiSettings,
  loadIdentity,
  loadStoredTheme,
  saveAiSettings,
  saveIdentity,
  saveTheme,
  setSpaceToken,
  subscribeAiSettings,
} from "./storage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("identity", () => {
  it("is empty until a name is saved", () => {
    expect(loadIdentity()).toBeNull();
  });

  it("creates an id, trims the name and derives the color", () => {
    const me = saveIdentity("  Deniz   Kaya ");
    expect(me.name).toBe("Deniz Kaya");
    expect(me.id.length).toBeGreaterThan(8);
    expect(me.color).toBe(colorFor(me.id));
    expect(loadIdentity()).toEqual(me);
  });

  it("keeps the id when the name changes", () => {
    const first = saveIdentity("Deniz");
    const second = saveIdentity("Deniz K.");
    expect(second.id).toBe(first.id);
    expect(loadIdentity()?.name).toBe("Deniz K.");
  });

  it("rejects an empty name and survives corrupt storage", () => {
    expect(() => saveIdentity("   ")).toThrow();
    window.localStorage.setItem("sofra:identity", "{not json");
    expect(loadIdentity()).toBeNull();
  });
});

describe("space tokens", () => {
  it("are stored per space", () => {
    setSpaceToken("a", "token-a");
    setSpaceToken("b", "token-b");
    expect(getSpaceToken("a")).toBe("token-a");
    clearSpaceToken("a");
    expect(getSpaceToken("a")).toBeNull();
    expect(getSpaceToken("b")).toBe("token-b");
  });
});

describe("AI settings", () => {
  it("round-trips, trims and drops an empty model", () => {
    expect(loadAiSettings()).toBeNull();
    saveAiSettings({ provider: "openai", apiKey: "  sk-12345678  ", model: "  " });
    expect(loadAiSettings()).toEqual({ provider: "openai", apiKey: "sk-12345678" });
    saveAiSettings({ provider: "anthropic", apiKey: "sk-ant-12345678", model: "some-model" });
    expect(loadAiSettings()).toEqual({
      provider: "anthropic",
      apiKey: "sk-ant-12345678",
      model: "some-model",
    });
  });

  it("returns a stable reference between changes and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiSettings(listener);
    saveAiSettings({ provider: "openai", apiKey: "sk-12345678" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadAiSettings()).toBe(loadAiSettings());
    clearAiSettings();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(loadAiSettings()).toBeNull();
    expect(window.localStorage.getItem("sofra:ai")).toBeNull();
    unsubscribe();
    saveAiSettings({ provider: "openai", apiKey: "sk-12345678" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores values that are not valid settings", () => {
    window.localStorage.setItem(
      "sofra:ai",
      JSON.stringify({ provider: "other", apiKey: "sk-12345678" }),
    );
    expect(loadAiSettings()).toBeNull();
    window.localStorage.setItem("sofra:ai", JSON.stringify({ provider: "openai", apiKey: "x" }));
    expect(loadAiSettings()).toBeNull();
  });
});

describe("theme", () => {
  it("stores only known themes", () => {
    expect(loadStoredTheme()).toBeNull();
    saveTheme("dark");
    expect(loadStoredTheme()).toBe("dark");
    window.localStorage.setItem("sofra:theme", "purple");
    expect(loadStoredTheme()).toBeNull();
  });
});
