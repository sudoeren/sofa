import { LIMITS, type MemberInfo } from "@sofra/shared";
import clsx from "clsx";
import { Check, Link2, Lock, PanelRight, Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { BrandMark } from "../components/Brand";
import { InlineEdit } from "../components/InlineEdit";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ConnectionStatus } from "../lib/space";

const MAX_AVATARS = 5;

type Props = {
  title: string;
  locked: boolean;
  status: ConnectionStatus;
  me: MemberInfo;
  members: MemberInfo[];
  panelOpen: boolean;
  onRenameSpace: (title: string) => void;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Offline",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers and non-secure origins (a LAN address over http)
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function Header({
  title,
  locked,
  status,
  me,
  members,
  panelOpen,
  onRenameSpace,
  onTogglePanel,
  onOpenSettings,
  onOpenGallery,
}: Props) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const invite = async () => {
    const ok = await copyText(window.location.href);
    setCopied(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2400);
  };

  const shown = members.slice(0, MAX_AVATARS);
  const hidden = members.slice(MAX_AVATARS);

  return (
    <header className="space-header">
      <div className="space-header-start">
        <Link className="brand brand-compact" to="/" aria-label="Sofra home">
          <BrandMark size={26} />
        </Link>
        <div className="space-title-wrap">
          <InlineEdit
            className="space-title"
            label="Space title"
            value={title}
            placeholder="Untitled space"
            maxLength={LIMITS.titleLength}
            onCommit={onRenameSpace}
          />
          <div className="space-sub">
            <span className={clsx("status", `status-${status}`)} role="status">
              <span className="status-dot" aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
            {locked ? (
              <span className="space-locked" title="This space is protected with a password">
                <Lock size={12} aria-hidden="true" />
                Locked
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-header-end">
        <ul className="members" aria-label={`${members.length} in this space`}>
          {shown.map((member) => (
            <li
              key={member.id}
              className="member"
              data-tip={member.id === me.id ? `${member.name} (you)` : member.name}
            >
              <button
                type="button"
                className="member-focus"
                aria-label={member.id === me.id ? `${member.name} (you)` : member.name}
              >
                <Avatar member={member} />
              </button>
            </li>
          ))}
          {hidden.length > 0 ? (
            <li className="member" data-tip={hidden.map((member) => member.name).join(", ")}>
              <button
                type="button"
                className="member-focus"
                aria-label={`${hidden.length} more: ${hidden.map((member) => member.name).join(", ")}`}
              >
                <span className="avatar avatar-more" aria-hidden="true">
                  +{hidden.length}
                </span>
              </button>
            </li>
          ) : null}
        </ul>

        <button type="button" className="btn hide-narrow" onClick={onOpenGallery}>
          <Plus size={16} aria-hidden="true" />
          <span>Add tool</span>
        </button>

        <button
          type="button"
          className={clsx("btn btn-primary invite", copied === "copied" && "is-done")}
          onClick={invite}
          aria-label="Invite: copy the link to this space"
        >
          {copied === "copied" ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Link2 size={16} aria-hidden="true" />
          )}
          <span className="invite-label">
            {copied === "copied"
              ? "Link copied"
              : copied === "failed"
                ? "Copy the address bar"
                : "Invite"}
          </span>
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {copied === "copied"
            ? "Link copied to the clipboard"
            : copied === "failed"
              ? "Could not copy. Copy the address from the address bar instead."
              : ""}
        </span>

        <ThemeToggle />
        <button
          type="button"
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={clsx("icon-btn", panelOpen && "is-active")}
          aria-label={
            panelOpen ? "Hide materials and conversation" : "Show materials and conversation"
          }
          title="Materials and conversation"
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
