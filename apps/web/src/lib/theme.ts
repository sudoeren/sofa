import { useCallback, useSyncExternalStore } from "react";
import { loadStoredTheme, saveTheme, type Theme } from "./storage";

const listeners = new Set<() => void>();
let current: Theme | null = null;

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Stored choice first, otherwise the system preference. */
export function initialTheme(): Theme {
  return loadStoredTheme() ?? systemTheme();
}

function getTheme(): Theme {
  if (!current) {
    current = initialTheme();
    document.documentElement.setAttribute("data-theme", current);
  }
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  document.documentElement.setAttribute("data-theme", theme);
  saveTheme(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, getTheme);
  const toggle = useCallback(() => setTheme(getTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}

/** Test helper. */
export function resetThemeForTests(): void {
  current = null;
}
