import {
  isToolToHost,
  type JsonValue,
  type MemberInfo,
  TOOL_LIMITS,
  type ToolToHost,
} from "@sofra/shared";

/**
 * Checks shared by both write paths (widgets through useToolState, HTML tools through the
 * frame). Everything that comes out of a frame is untrusted: it arrives by structured
 * clone, so it can be a Map, a Date, a cyclic object or a 200 MB string. Nothing here
 * trusts the SDK to have checked first.
 */

const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
/** Longest error text a frame can make the host display. */
export const MAX_ERROR_LENGTH = 500;

const encoder = new TextEncoder();

export type JsonCheck =
  | { ok: true; value: JsonValue; json: string; bytes: number }
  | { ok: false; reason: string };

/**
 * Accept only plain JSON data (null, booleans, finite numbers, strings, arrays and plain
 * objects) within `maxBytes` of UTF-8 JSON. Returns a private deep copy so the caller's
 * object can never alias what is stored in the document.
 */
export function checkJsonValue(
  input: unknown,
  maxBytes: number = TOOL_LIMITS.maxValueBytes,
): JsonCheck {
  // Walk first: it rejects exotic objects before JSON.stringify could call a toJSON hook,
  // and it stops early on huge inputs (the running size is a lower bound of the real one).
  let nodes = 0;
  let size = 0;
  const walk = (value: unknown, depth: number): string | null => {
    if (++nodes > MAX_NODES) return "value is too complex";
    if (value === null) return null;
    switch (typeof value) {
      case "boolean":
        return null;
      case "number":
        return Number.isFinite(value) ? null : "numbers must be finite";
      case "string":
        size += value.length;
        return size > maxBytes ? "value is too large" : null;
      case "object":
        break;
      default:
        return `${typeof value} is not a JSON value`;
    }
    if (depth >= MAX_DEPTH) return "value is nested too deeply";
    if (Array.isArray(value)) {
      // A sparse array would be walked hole by hole; bound it by length up front.
      if (value.length > MAX_NODES) return "value is too complex";
      for (let i = 0; i < value.length; i++) {
        const problem = walk(value[i], depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return "only plain objects are allowed";
    for (const key of Object.keys(value as object)) {
      size += key.length;
      if (size > maxBytes) return "value is too large";
      const problem = walk((value as Record<string, unknown>)[key], depth + 1);
      if (problem) return problem;
    }
    return null;
  };

  const problem = walk(input, 0);
  if (problem) return { ok: false, reason: problem };

  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return { ok: false, reason: "value is not JSON" };
  }
  if (typeof json !== "string") return { ok: false, reason: "value is not JSON" };
  const bytes = encoder.encode(json).length;
  if (bytes > maxBytes) return { ok: false, reason: "value is too large" };
  return { ok: true, value: JSON.parse(json) as JsonValue, json, bytes };
}

export function checkKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= TOOL_LIMITS.maxKeyLength;
}

/** Messages that exist only on the private channel between the host and the SDK. */
export type FrameMessage =
  | ToolToHost
  /** first message on the port: proves the sender is the document the host built */
  | { type: "sofra:hello"; nonce: string }
  /** answer to the host's liveness ping */
  | { type: "sofra:pong" };

export type FrameVerdict =
  | { kind: "accept"; message: FrameMessage }
  /**
   * A write that is well formed enough to name its key but must not be applied. The host
   * answers it with the authoritative value so the frame converges.
   */
  | { kind: "reject"; key: string; reason: string }
  | { kind: "ignore" };

const IGNORE: FrameVerdict = { kind: "ignore" };

const SHAPES: Record<string, readonly string[]> = {
  "sofra:ready": ["type"],
  "sofra:set": ["type", "key", "value"],
  "sofra:delete": ["type", "key"],
  "sofra:resize": ["type", "height"],
  "sofra:error": ["type", "message"],
  "sofra:hello": ["type", "nonce"],
  "sofra:pong": ["type"],
};

/**
 * Strict validation of anything a frame sends. Unknown types, extra fields, wrong field
 * types and non-plain objects are ignored without a reply.
 */
export function checkFrameMessage(data: unknown): FrameVerdict {
  if (!data || typeof data !== "object" || Array.isArray(data)) return IGNORE;
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return IGNORE;
  const record = data as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return IGNORE;
  const shape = SHAPES[type];
  if (!shape) return IGNORE;
  if (type !== "sofra:hello" && type !== "sofra:pong" && !isToolToHost(data)) return IGNORE;
  const keys = Object.keys(record);
  if (keys.length !== shape.length || !keys.every((key) => shape.includes(key))) return IGNORE;

  switch (type) {
    case "sofra:ready":
      return { kind: "accept", message: { type } };
    case "sofra:pong":
      return { kind: "accept", message: { type } };
    case "sofra:hello": {
      const nonce = record.nonce;
      if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 128) return IGNORE;
      return { kind: "accept", message: { type, nonce } };
    }
    case "sofra:set": {
      const key = record.key;
      if (!checkKey(key)) return IGNORE;
      const checked = checkJsonValue(record.value);
      if (!checked.ok) return { kind: "reject", key, reason: checked.reason };
      return { kind: "accept", message: { type, key, value: checked.value } };
    }
    case "sofra:delete": {
      const key = record.key;
      if (!checkKey(key)) return IGNORE;
      return { kind: "accept", message: { type, key } };
    }
    case "sofra:resize": {
      const height = record.height;
      if (typeof height !== "number" || !Number.isFinite(height) || height < 0) return IGNORE;
      return { kind: "accept", message: { type, height: clampHeight(height) } };
    }
    case "sofra:error": {
      const message = record.message;
      if (typeof message !== "string") return IGNORE;
      return { kind: "accept", message: { type, message: cleanErrorText(message) } };
    }
    default:
      return IGNORE;
  }
}

/**
 * The only message accepted on the window itself: the first "sofra:ready" of the frame
 * this host created. Everything after it travels on a private MessagePort.
 */
export function isReadyFromFrame(
  event: { source: unknown; data: unknown },
  frameWindow: unknown,
): boolean {
  if (!frameWindow || event.source !== frameWindow) return false;
  const verdict = checkFrameMessage(event.data);
  return verdict.kind === "accept" && verdict.message.type === "sofra:ready";
}

export function clampHeight(height: number): number {
  if (!Number.isFinite(height)) return TOOL_LIMITS.minFrameHeight;
  return Math.min(
    TOOL_LIMITS.maxFrameHeight,
    Math.max(TOOL_LIMITS.minFrameHeight, Math.ceil(height)),
  );
}

export function cleanErrorText(text: string): string {
  // Collapse whitespace and drop control characters; it is shown as plain text.
  const flat = text
    .slice(0, MAX_ERROR_LENGTH * 4)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_ERROR_LENGTH ? `${flat.slice(0, MAX_ERROR_LENGTH - 3)}...` : flat;
}

/** Copy exactly the three public fields; anything else on the object stays in the host. */
export function publicMember(member: MemberInfo): MemberInfo {
  return {
    id: String(member?.id ?? ""),
    name: String(member?.name ?? ""),
    color: String(member?.color ?? ""),
  };
}

/** Token bucket for writes coming out of one frame. */
export class WriteBudget {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity = 240,
    private readonly perSecond = 60,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (Math.max(0, t - this.last) / 1000) * this.perSecond,
    );
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
