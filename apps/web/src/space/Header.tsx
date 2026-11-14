import { LIMITS, type MemberInfo } from "@sofa/shared";
import clsx from "clsx";
import { Lock, PanelRight, Plus, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Wordmark } from "../components/Brand";
import { InlineEdit } from "../components/InlineEdit";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ConnectionStatus } from "../lib/space";
import { InvitePopover } from "./InvitePopover";

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
  /** the member copied or shared the invite link */
  onInvited?: () => void;
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Offline",
};

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
  onInvited,
}: Props) {
  const shown = members.slice(0, MAX_AVATARS);
  const hidden = members.slice(MAX_AVATARS);

  return (
    <header className="space-header">
      <div className="space-header-start">
        <Link className="brand brand-compact" to="/" aria-label="Sofa home">
          <Wordmark size={18} />
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

        <button type="button" className="btn btn-add" onClick={onOpenGallery} aria-label="Add tool">
          <Plus size={16} aria-hidden="true" />
          <span className="hide-narrow">Add tool</span>
        </button>

        <InvitePopover title={title} locked={locked} onInvited={onInvited} />

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
