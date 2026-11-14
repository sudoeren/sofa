import { LIMITS, type MemberInfo, type ToolRecord } from "@sofa/shared";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  GripVertical,
  Maximize2,
  Minimize2,
  Trash2,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import {
  Component,
  type DragEvent,
  memo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type * as Y from "yjs";
import { InlineEdit } from "../components/InlineEdit";
import { Menu, MenuItem } from "../components/Menu";
import { deleteTool, moveTool, renameTool, setToolSpan } from "../lib/tools";
import { ToolView } from "../runtime";

/** A tool that throws while rendering must not take the space down with it. */
class ToolBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="tool-crash" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <p>
            This tool ran into a problem and could not be shown. Ask the AI to change it, or delete
            it.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

type Props = {
  doc: Y.Doc;
  tool: ToolRecord;
  me: MemberInfo;
  members: MemberInfo[];
  theme: "light" | "dark";
  isFirst: boolean;
  isLast: boolean;
  /** the prompt bar is aimed at this tool */
  targeted: boolean;
  /** briefly emphasised after "show me this tool" */
  highlighted: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onChangeWithAi: (toolId: string) => void;
  onDragStart: (toolId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (toolId: string, event: DragEvent<HTMLElement>) => void;
  onDrop: (toolId: string, event: DragEvent<HTMLElement>) => void;
};

export const ToolCard = memo(function ToolCard({
  doc,
  tool,
  me,
  members,
  theme,
  isFirst,
  isLast,
  targeted,
  highlighted,
  dragging,
  dropTarget,
  onChangeWithAi,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const wide = tool.span === 2;

  return (
    <article
      ref={cardRef}
      id={`tool-${tool.id}`}
      className={clsx(
        "tool-card",
        wide && "tool-card-wide",
        targeted && "is-targeted",
        highlighted && "is-highlighted",
        dragging && "is-dragging",
        dropTarget && "is-drop-target",
        menuOpen && "has-menu",
      )}
      aria-label={tool.title || "Untitled tool"}
      onDragOver={(event) => onDragOver(tool.id, event)}
      onDrop={(event) => onDrop(tool.id, event)}
    >
      {confirming ? (
        <div
          className="tool-confirm"
          role="alertdialog"
          aria-label={`Delete ${tool.title || "this tool"}?`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirming(false);
          }}
        >
          <p>
            Delete <strong>{tool.title || "this tool"}</strong> and everything in it?
          </p>
          <div className="tool-confirm-actions">
            <button
              ref={cancelRef}
              type="button"
              className="btn btn-sm"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => deleteTool(doc, tool.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <header className="tool-head">
          <span
            className="tool-grip"
            draggable
            title="Drag to reorder"
            aria-hidden="true"
            onDragStart={(event) => {
              if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, 24, 20);
              onDragStart(tool.id, event);
            }}
            onDragEnd={onDragEnd}
          >
            <GripVertical size={16} />
          </span>
          <InlineEdit
            className="tool-title"
            label="Tool title"
            value={tool.title}
            placeholder="Untitled tool"
            maxLength={LIMITS.titleLength}
            onCommit={(title) => renameTool(doc, tool.id, title)}
          />
          <Menu
            label={`Actions for ${tool.title || "tool"}`}
            icon={<Ellipsis size={18} aria-hidden="true" />}
            onOpenChange={setMenuOpen}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<WandSparkles size={16} />}
                  onSelect={() => {
                    close(false);
                    onChangeWithAi(tool.id);
                  }}
                >
                  Change with AI
                </MenuItem>
                <MenuItem
                  icon={wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  onSelect={() => {
                    close();
                    setToolSpan(doc, tool.id, wide ? 1 : 2);
                  }}
                >
                  {wide ? "Make narrower" : "Make wider"}
                </MenuItem>
                <MenuItem
                  icon={<ArrowLeft size={16} />}
                  disabled={isFirst}
                  onSelect={() => {
                    close();
                    moveTool(doc, tool.id, -1);
                  }}
                >
                  Move earlier
                </MenuItem>
                <MenuItem
                  icon={<ArrowRight size={16} />}
                  disabled={isLast}
                  onSelect={() => {
                    close();
                    moveTool(doc, tool.id, 1);
                  }}
                >
                  Move later
                </MenuItem>
                <hr className="menu-sep" />
                <MenuItem
                  danger
                  icon={<Trash2 size={16} />}
                  onSelect={() => {
                    close(false);
                    setConfirming(true);
                  }}
                >
                  Delete
                </MenuItem>
              </>
            )}
          </Menu>
        </header>
      )}
      <div className="tool-body">
        <ToolBoundary
          resetKey={`${tool.kind}:${tool.widgetType ?? ""}:${tool.version}:${tool.status}`}
        >
          <ToolView doc={doc} toolId={tool.id} me={me} members={members} theme={theme} />
        </ToolBoundary>
      </div>
    </article>
  );
});
