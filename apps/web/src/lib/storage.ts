import { colorFor, type MemberInfo, type UserAi } from "@sofra/shared";
import { nanoid } from "nanoid";

/** Everything the app keeps in this browser. All access is guarded: storage can be blocked. */

const IDENTITY_KEY = "sofra:identity";
const AI_KEY = "sofra:ai";
const THEME_KEY = "sofra:theme";
const tokenKey = (spaceId: string) => `sofra:token:${spaceId}`;

export const NAME_MAX = 60;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode, quota): the app keeps working for this session
  }
}

function readJson(key: string): unknown {
  const raw = read(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* identity */

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/** The stored member, or null when no name has been chosen yet. */
export function loadIdentity(): MemberInfo | null {
  const value = readJson(IDENTITY_KEY) as { id?: unknown; name?: unknown } | null;
  if (!value || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const name = cleanName(value.name);
  if (!value.id || !name) return null;
  return { id: value.id, name, color: colorFor(value.id) };
}

/** Save a display name, keeping the existing id when there is one. */
export function saveIdentity(name: string): MemberInfo {
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error("Please enter a name.");
  const existing = readJson(IDENTITY_KEY) as { id?: unknown } | null;
  const id = existing && typeof existing.id === "string" && existing.id ? existing.id : nanoid(16);
  write(IDENTITY_KEY, JSON.stringify({ id, name: cleaned }));
  return { id, name: cleaned, color: colorFor(id) };
}

/* tokens of locked spaces */

export function getSpaceToken(spaceId: string): string | null {
  return read(tokenKey(spaceId)) || null;
}

export function setSpaceToken(spaceId: string, token: string): void {
  write(tokenKey(spaceId), token);
}

export function clearSpaceToken(spaceId: string): void {
  write(tokenKey(spaceId), null);
}

/* the member's own AI key */

const aiListeners = new Set<() => void>();
let aiCache: { raw: string | null; value: UserAi | null } | null = null;

export function loadAiSettings(): UserAi | null {
  const raw = read(AI_KEY);
  if (aiCache && aiCache.raw === raw) return aiCache.value;
  let value: UserAi | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { provider?: unknown; apiKey?: unknown; model?: unknown };
      if (
        (parsed.provider === "anthropic" ||
          parsed.provider === "openai" ||
          parsed.provider === "openrouter") &&
        typeof parsed.apiKey === "string" &&
        parsed.apiKey.length >= 8
      ) {
        value = { provider: parsed.provider, apiKey: parsed.apiKey };
        if (typeof parsed.model === "string" && parsed.model.trim()) {
          value.model = parsed.model.trim();
        }
      }
    } catch {
      value = null;
    }
  }
  aiCache = { raw, value };
  return value;
}

export function saveAiSettings(settings: UserAi): void {
  const value: UserAi = { provider: settings.provider, apiKey: settings.apiKey.trim() };
  const model = settings.model?.trim();
  if (model) value.model = model;
  write(AI_KEY, JSON.stringify(value));
  for (const listener of aiListeners) listener();
}

export function clearAiSettings(): void {
  write(AI_KEY, null);
  for (const listener of aiListeners) listener();
}

export function subscribeAiSettings(listener: () => void): () => void {
  aiListeners.add(listener);
  return () => {
    aiListeners.delete(listener);
  };
}

/* theme */

export type Theme = "light" | "dark";
/** What the member picked; "system" follows the operating system and is the default. */
export type ThemePreference = Theme | "system";

export function loadStoredTheme(): ThemePreference | null {
  const value = read(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function saveTheme(theme: ThemePreference): void {
  write(THEME_KEY, theme);
}
