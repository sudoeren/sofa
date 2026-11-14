import { useCallback, useSyncExternalStore } from "react";
import { loadStoredTheme, saveTheme, type Theme, type ThemePreference } from "./storage";

const listeners = new Set<() => void>();
let preference: ThemePreference | null = null;
let media: MediaQueryList | null = null;

function darkQuery(): MediaQueryList | null {
  try {
    media ??= window.matchMedia("(prefers-color-scheme: dark)");
    return media;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return darkQuery()?.matches ? "dark" : "light";
}

function getPreference(): ThemePreference {
  preference ??= loadStoredTheme() ?? "system";
  return preference;
}

/** The theme actually shown: the member's pick, or the system's when they chose "system". */
function getTheme(): Theme {
  const pick = getPreference();
  return pick === "system" ? systemTheme() : pick;
}

function apply(): void {
  document.documentElement.setAttribute("data-theme", getTheme());
  for (const listener of listeners) listener();
}

export function setThemePreference(pick: ThemePreference): void {
  preference = pick;
  saveTheme(pick);
  apply();
}

function onSystemChange(): void {
  if (getPreference() === "system") apply();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) darkQuery()?.addEventListener?.("change", onSystemChange);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) darkQuery()?.removeEventListener?.("change", onSystemChange);
  };
}

export function useTheme(): {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (pick: ThemePreference) => void;
} {
  const theme = useSyncExternalStore(subscribe, getTheme);
  const pick = useSyncExternalStore(subscribe, getPreference);
  const setPreference = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return { theme, preference: pick, setPreference };
}

/** Test helper. */
export function resetThemeForTests(): void {
  preference = null;
  media = null;
}
