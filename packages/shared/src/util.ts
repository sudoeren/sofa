import { customAlphabet, nanoid } from "nanoid";

const spaceAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const makeSpaceId = customAlphabet(spaceAlphabet, 21);

/** Unguessable space id; knowing it is what grants access to a space. */
export function newSpaceId(): string {
  return makeSpaceId();
}

export function newId(): string {
  return nanoid(12);
}

export function isSpaceId(value: string): boolean {
  return /^[0-9A-Za-z]{21}$/.test(value);
}

export const MEMBER_COLORS = [
  "#c2410c",
  "#0f766e",
  "#6d28d9",
  "#b45309",
  "#0369a1",
  "#be123c",
  "#4d7c0f",
  "#a21caf",
] as const;

/** Stable color for a member id. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return MEMBER_COLORS[hash % MEMBER_COLORS.length] ?? MEMBER_COLORS[0];
}

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}
