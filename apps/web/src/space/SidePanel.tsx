import type { ToolRecord } from "@sofa/shared";
import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useId } from "react";
import { Credit } from "../components/Credit";
import { Conversation } from "./Conversation";
import { Materials } from "./Materials";

export type PanelTab = "materials" | "conversation";

type Props = {
  open: boolean;
  tab: PanelTab;
  materialCount: number;
  pendingCount: number;
  tools: ToolRecord[];
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  onShowTool: (toolId: string) => void;
};

/** A column on wide screens, a bottom sheet on narrow ones (see space.css). */
export function SidePanel({
  open,
  tab,
  materialCount,
  pendingCount,
  tools,
  onTab,
  onClose,
  onShowTool,
}: Props) {
  const baseId = useId();
  const tabs: { id: PanelTab; label: string }[] = [
    { id: "materials", label: "Materials" },
    { id: "conversation", label: "Conversation" },
  ];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // only the sheet closes on Escape; the column stays put
      if (event.key === "Escape" && window.matchMedia("(max-width: 899px)").matches) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="panel" aria-label="Materials and conversation">
        <div className="panel-head">
          <div className="tabs" role="tablist" aria-label="Side panel">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                className={clsx("tab", tab === item.id && "is-selected")}
                onClick={() => onTab(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = item.id === "materials" ? "conversation" : "materials";
                    onTab(next);
                    document.getElementById(`${baseId}-tab-${next}`)?.focus();
                  }
                }}
              >
                <span>{item.label}</span>
                {item.id === "materials" && materialCount > 0 ? (
                  <span className="tab-count">{materialCount}</span>
                ) : null}
                {item.id === "conversation" && pendingCount > 0 ? (
                  <span className="tab-dot" role="img" aria-label="working" />
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn panel-close"
            aria-label="Close panel"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div
          className="panel-body"
          role="tabpanel"
          id={`${baseId}-panel-${tab}`}
          aria-labelledby={`${baseId}-tab-${tab}`}
        >
          {tab === "materials" ? (
            <Materials />
          ) : (
            <Conversation tools={tools} onShowTool={onShowTool} />
          )}
        </div>
        <div className="panel-foot">
          <Credit />
        </div>
      </aside>
    </>
  );
}
