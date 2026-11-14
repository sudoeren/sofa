import type { ServerConfig } from "@sofa/shared";
import { X } from "lucide-react";
import { useState } from "react";
import { hideDemoNotice, isDemoNoticeHidden } from "../lib/storage";

export const REPO_URL = "https://github.com/sudoeren/sofa";

type Props = {
  /** null while the config is loading: nothing is rendered and no space is reserved */
  config: ServerConfig | null;
  /** inside a space: offers to download it */
  onDownload?: () => void;
  downloadBusy?: boolean;
  downloadError?: string;
};

function ttlText(hours: number): string {
  if (hours <= 0) return "";
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** A quiet strip at the top of the page on a public demo server. */
export function DemoNotice({ config, onDownload, downloadBusy, downloadError }: Props) {
  const [hidden, setHidden] = useState(isDemoNoticeHidden);
  if (!config?.demo || hidden) return null;
  const ttl = ttlText(config.spaceTtlHours);

  return (
    <aside className="demo-notice" aria-label="About this demo">
      <p className="demo-notice-text">
        <span>
          This is a demo.
          {ttl ? ` Spaces are deleted after ${ttl} without changes.` : ""}
        </span>
        <span className="demo-notice-links">
          {onDownload ? (
            <button
              type="button"
              className="demo-notice-link"
              onClick={onDownload}
              disabled={downloadBusy}
            >
              {downloadBusy ? "Preparing download" : "Download this space"}
            </button>
          ) : null}
          <a className="demo-notice-link" href={REPO_URL} target="_blank" rel="noreferrer">
            Host your own
          </a>
        </span>
        {downloadError ? (
          <span className="demo-notice-error" role="alert">
            {downloadError}
          </span>
        ) : null}
      </p>
      <button
        type="button"
        className="demo-notice-close"
        aria-label="Dismiss demo notice"
        onClick={() => {
          hideDemoNotice();
          setHidden(true);
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </aside>
  );
}
