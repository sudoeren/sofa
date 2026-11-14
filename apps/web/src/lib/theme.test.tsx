import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetThemeForTests, useTheme } from "./theme";

function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetThemeForTests();
});

describe("useTheme", () => {
  it("follows the system by default and reacts when it changes", () => {
    const system = fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("light");
    act(() => system.set(true));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("a fixed choice ignores the system and is remembered", () => {
    const system = fakeSystem(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("light"));
    expect(result.current.theme).toBe("light");
    act(() => system.set(true));
    expect(result.current.theme).toBe("light");
    expect(window.localStorage.getItem("sofra:theme")).toBe("light");
  });
});
