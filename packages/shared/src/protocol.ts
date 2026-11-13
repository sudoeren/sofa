import type { JsonValue, MemberInfo, ToolState } from "./schema";

/**
 * postMessage protocol between the host page and a tool frame.
 * Every message is a plain object with a "type" starting with "sofra:".
 * The host only accepts messages whose event.source is the frame it created.
 */

export type Theme = "light" | "dark";

export type HostToTool =
  | {
      type: "sofra:init";
      toolId: string;
      state: ToolState;
      me: MemberInfo;
      members: MemberInfo[];
      theme: Theme;
    }
  /** one key changed remotely (or was rejected locally and must be restored) */
  | { type: "sofra:state"; key: string; value: JsonValue | undefined }
  /** full state replacement, used after reconnects */
  | { type: "sofra:state-all"; state: ToolState }
  | { type: "sofra:members"; members: MemberInfo[] }
  | { type: "sofra:theme"; theme: Theme };

export type ToolToHost =
  | { type: "sofra:ready" }
  | { type: "sofra:set"; key: string; value: JsonValue }
  | { type: "sofra:delete"; key: string }
  | { type: "sofra:resize"; height: number }
  | { type: "sofra:error"; message: string };

/** Limits enforced by the host on writes coming from a frame. */
export const TOOL_LIMITS = {
  maxKeyLength: 200,
  maxValueBytes: 64 * 1024,
  maxKeys: 5000,
  maxFrameHeight: 4000,
  minFrameHeight: 120,
} as const;

export function isToolToHost(data: unknown): data is ToolToHost {
  if (!data || typeof data !== "object") return false;
  const type = (data as { type?: unknown }).type;
  return (
    type === "sofra:ready" ||
    type === "sofra:set" ||
    type === "sofra:delete" ||
    type === "sofra:resize" ||
    type === "sofra:error"
  );
}
