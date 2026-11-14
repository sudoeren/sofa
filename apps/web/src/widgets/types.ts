import type { JsonValue, MemberInfo, ToolState } from "@sofa/shared";

/**
 * Props of every built-in widget component. `data` is an immutable snapshot of the tool's
 * shared state; the component re-renders with a new snapshot after any change, local or
 * remote. Each top-level key is last-write-wins, so store one key per independently edited
 * thing ("vote:<memberId>", "item:<id>").
 */
export type WidgetProps<C> = {
  config: C;
  data: ToolState;
  set: (key: string, value: JsonValue) => void;
  del: (key: string) => void;
  me: MemberInfo;
  members: MemberInfo[];
};
