import type { JsonValue, MemberInfo, Theme, ToolRecord } from "@sofra/shared";
import { getWidgetDef } from "@sofra/widgets";
import { TriangleAlert } from "lucide-react";
import { Component, type ComponentType, type ReactNode, useMemo } from "react";
import type * as Y from "yjs";
import { WIDGETS } from "../widgets";
import type { WidgetProps } from "../widgets/types";
import { ToolFrame } from "./ToolFrame";
import { useToolRecord, useToolState } from "./useToolState";
import "./runtime.css";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
export type WidgetRegistry = Record<string, ComponentType<WidgetProps<any>>>;

/** The part of a widget definition the runtime needs. */
export type WidgetDefLookup = (type: string) =>
  | {
      configSchema: {
        safeParse(
          input: unknown,
        ): { success: true; data: unknown } | { success: false; error: { message?: string } };
      };
    }
  | undefined;

export type ToolViewProps = {
  doc: Y.Doc;
  toolId: string;
  me: MemberInfo;
  members: MemberInfo[];
  theme: Theme;
  /** override the built-in registry and catalog (tests, embedding) */
  widgets?: WidgetRegistry;
  getDef?: WidgetDefLookup;
};

/** Body of one tool card: the native widget or the sandboxed frame, plus status. */
export function ToolView({ doc, toolId, me, members, theme, widgets, getDef }: ToolViewProps) {
  const record = useToolRecord(doc, toolId);
  if (!record) return <Message>This tool no longer exists.</Message>;

  const hasContent =
    record.kind === "widget" ? Boolean(record.widgetType) : Boolean(record.html?.trim());

  let content: ReactNode = null;
  if (hasContent && record.kind === "widget") {
    content = (
      <WidgetHost
        doc={doc}
        record={record}
        me={me}
        members={members}
        widgets={widgets ?? WIDGETS}
        getDef={getDef ?? getWidgetDef}
      />
    );
  } else if (hasContent && record.kind === "html") {
    content = (
      <ToolFrame
        doc={doc}
        toolId={toolId}
        html={record.html}
        version={record.version}
        title={record.title}
        me={me}
        members={members}
        theme={theme}
      />
    );
  }

  return (
    <div className="rt-root" data-status={record.status}>
      {record.status === "error" && (
        <div className="rt-strip rt-strip-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <span className="rt-strip-text">{record.error || "Something went wrong."}</span>
        </div>
      )}
      {record.status === "generating" &&
        (content ? (
          <div className="rt-working" role="status">
            <span className="rt-working-bar" aria-hidden="true" />
            Updating this tool
          </div>
        ) : (
          <div className="rt-skeleton" role="status" aria-label="Building this tool">
            <span />
            <span />
            <span />
            <p>Building this tool</p>
          </div>
        ))}
      {content}
      {!content && record.status === "ready" && <Message>This tool is empty.</Message>}
    </div>
  );
}

function Message({ children, detail }: { children: ReactNode; detail?: string }) {
  return (
    <div className="rt-message">
      <p>{children}</p>
      {detail && <p className="rt-message-detail">{detail}</p>}
    </div>
  );
}

type WidgetHostProps = {
  doc: Y.Doc;
  record: ToolRecord;
  me: MemberInfo;
  members: MemberInfo[];
  widgets: WidgetRegistry;
  getDef: WidgetDefLookup;
};

function WidgetHost({ doc, record, me, members, widgets, getDef }: WidgetHostProps) {
  const { data, set, del } = useToolState(doc, record.id);
  const type = record.widgetType ?? "";
  const Widget = Object.hasOwn(widgets, type) ? widgets[type] : undefined;
  const def = getDef(type);
  const config: JsonValue | undefined = record.config;
  const parsed = useMemo(() => def?.configSchema.safeParse(config), [def, config]);

  if (!Widget || !def || !parsed) {
    return (
      <Message detail={type ? `Type: ${type}` : undefined}>
        This kind of tool is not available here.
      </Message>
    );
  }
  if (!parsed.success) {
    return (
      <Message detail={String(parsed.error?.message ?? "").slice(0, 300) || undefined}>
        The settings of this tool are not valid. Ask for it to be rebuilt.
      </Message>
    );
  }
  return (
    <WidgetBoundary resetKey={parsed}>
      <Widget config={parsed.data} data={data} set={set} del={del} me={me} members={members} />
    </WidgetBoundary>
  );
}

type BoundaryProps = { resetKey: unknown; children: ReactNode };
type BoundaryState = { error: Error | null; resetKey: unknown };

/** Keeps a crashing widget from taking the space down; recovers when its config changes. */
class WidgetBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): BoundaryState | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown): void {
    console.error("[sofra] widget crashed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rt-message" role="alert">
        <p>This tool ran into a problem.</p>
        <p className="rt-message-detail">{this.state.error.message.slice(0, 300)}</p>
        <button type="button" className="rt-btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
