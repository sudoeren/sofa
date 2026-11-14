import clsx from "clsx";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Popover } from "../components/Popover";
import { QrCode } from "../components/QrCode";

export async function copyText(text: string): Promise<boolean> {
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

type Props = {
  title: string;
  locked: boolean;
  onInvited?: () => void;
};

/** The space link without anything after the path (no hash, no query). */
function inviteLink(): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

export function InvitePopover({ title, locked, onInvited }: Props) {
  return (
    <Popover
      label="Invite people"
      className="invite-pop"
      trigger={(props, open) => (
        <button
          type="button"
          className={clsx("btn btn-primary invite", open && "is-open")}
          aria-label="Invite"
          {...props}
        >
          <Link2 size={16} aria-hidden="true" />
          <span className="invite-label">Invite</span>
        </button>
      )}
    >
      {() => <InvitePanel title={title} locked={locked} onInvited={onInvited} />}
    </Popover>
  );
}

function InvitePanel({ title, locked, onInvited }: Props) {
  const link = inviteLink();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  const fieldRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const canShare = typeof navigator.share === "function";
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(link);
    setCopied(ok ? "copied" : "failed");
    if (ok) onInvited?.();
    else fieldRef.current?.select();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2400);
  };

  const share = async () => {
    try {
      await navigator.share({ title: title || "Sofa", url: link });
      onInvited?.();
    } catch {
      // cancelled or not allowed: the link and Copy are still there
    }
  };

  return (
    <>
      <h2 className="invite-title">Invite people</h2>
      <p className="invite-text">
        Anyone with this link can join and edit.
        {locked ? " They also need the password." : ""}
      </p>
      <label className="sr-only" htmlFor={fieldId}>
        Link to this space
      </label>
      <div className="invite-row">
        <input
          id={fieldId}
          ref={fieldRef}
          className="input input-mono invite-field"
          value={link}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn" onClick={copy} data-autofocus>
          {copied === "copied" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          <span>{copied === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {copied === "copied"
          ? "Link copied to the clipboard"
          : copied === "failed"
            ? "Could not copy. The link is selected; copy it yourself."
            : ""}
      </p>
      {copied === "failed" ? (
        <p className="invite-note">Could not copy. The link is selected; copy it yourself.</p>
      ) : null}
      {canShare ? (
        <button type="button" className="btn invite-share" onClick={share}>
          <Share2 size={15} aria-hidden="true" />
          <span>Share</span>
        </button>
      ) : null}
      <div className="invite-qr">
        <QrCode value={link} label="QR code of the link to this space" />
        <p className="invite-note">Scan with a phone camera to join.</p>
      </div>
    </>
  );
}
