import type { MemberInfo, ToolRecord } from "@sofa/shared";
import clsx from "clsx";
import { type DragEvent, useCallback, useState } from "react";
import type * as Y from "yjs";
import { moveToolTo } from "../lib/tools";
import { ToolCard } from "./ToolCard";

const DRAG_TYPE = "application/x-sofa-tool";

type Props = {
  doc: Y.Doc;
  tools: ToolRecord[];
  me: MemberInfo;
  members: MemberInfo[];
  theme: "light" | "dark";
  targetId: string | null;
  highlightId: string | null;
  onChangeWithAi: (toolId: string) => void;
};

export function ToolGrid({
  doc,
  tools,
  me,
  members,
  theme,
  targetId,
  highlightId,
  onChangeWithAi,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const onDragStart = useCallback((toolId: string, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, toolId);
    event.dataTransfer.setData("text/plain", toolId);
    // let the browser take its drag image before the card is dimmed
    window.setTimeout(() => setDragId(toolId), 0);
  }, []);

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  const onDragOver = useCallback((toolId: string, event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOverId((current) => (current === toolId ? current : toolId));
  }, []);

  const onDrop = useCallback(
    (toolId: string, event: DragEvent<HTMLElement>) => {
      const sourceId = event.dataTransfer.getData(DRAG_TYPE);
      if (!sourceId) return;
      event.preventDefault();
      setDragId(null);
      setOverId(null);
      moveToolTo(doc, sourceId, toolId);
    },
    [doc],
  );

  return (
    <div className={clsx("tool-grid", dragId && "is-reordering")}>
      {tools.map((tool, index) => (
        <ToolCard
          key={tool.id}
          doc={doc}
          tool={tool}
          me={me}
          members={members}
          theme={theme}
          isFirst={index === 0}
          isLast={index === tools.length - 1}
          targeted={targetId === tool.id}
          highlighted={highlightId === tool.id}
          dragging={dragId === tool.id}
          dropTarget={dragId !== null && dragId !== tool.id && overId === tool.id}
          onChangeWithAi={onChangeWithAi}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}
