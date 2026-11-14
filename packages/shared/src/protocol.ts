import type { JsonValue, MemberInfo, ToolState } from "./schema";

/**
 * postMessage protocol between the host page and a tool frame.
 * Every message is a plain object with a "type" starting with "sofa:".
 * The host only accepts messages whose event.source is the frame it created.
 */

export type Theme = "light" | "dark";

export type HostToTool =
  | {
      type: "sofa:init";
      toolId: string;
      state: ToolState;
      me: MemberInfo;
      members: MemberInfo[];
      theme: Theme;
    }
  /** one key changed remotely (or was rejected locally and must be restored) */
  | { type: "sofa:state"; key: string; value: JsonValue | undefined }
  /** full state replacement, used after reconnects */
  | { type: "sofa:state-all"; state: ToolState }
  | { type: "sofa:members"; members: MemberInfo[] }
  | { type: "sofa:theme"; theme: Theme };

export type ToolToHost =
  | { type: "sofa:ready" }
  | { type: "sofa:set"; key: string; value: JsonValue }
  | { type: "sofa:delete"; key: string }
  | { type: "sofa:resize"; height: number }
  | { type: "sofa:error"; message: string };

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
    type === "sofa:ready" ||
    type === "sofa:set" ||
    type === "sofa:delete" ||
    type === "sofa:resize" ||
    type === "sofa:error"
  );
}
