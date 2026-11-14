import { LIMITS, type MemberInfo, type UserAi } from "@sofra/shared";
import { ArrowUp, Info, PencilLine, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Spinner } from "../components/Spinner";
import { ApiError, generate } from "../lib/api";

export type PromptTarget = { id: string; title: string };

type Props = {
  spaceId: string;
  me: MemberInfo;
  value: string;
  onChange: (value: string) => void;
  /** the tool the request will change, if any */
  target: PromptTarget | null;
  onClearTarget: () => void;
  /** whether the server has its own provider; null while unknown */
  serverAi: boolean | null;
  /** the member's own key, if they saved one */
  memberAi: UserAi | null;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
  /** called after the server accepted the request */
  onSent?: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

function errorText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 429) {
      return "Too many requests right now. Wait a moment, then send it again.";
    }
    if (cause.status === 0) {
      return "Could not reach the server. Your request was not sent; check the connection and try again.";
    }
    return cause.message;
  }
  return "Something went wrong. Your request was not sent.";
}

export function PromptBar({
  spaceId,
  me,
  value,
  onChange,
  target,
  onClearTarget,
  serverAi,
  memberAi,
  onOpenSettings,
  onOpenGallery,
  onSent,
  inputRef,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const inputId = useId();
  const errorId = useId();
  const noAi = serverAi === false && !memberAi;
  const canSend = !busy && value.trim().length > 0;

  // grow with the content, up to a limit set in CSS
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value, ref]);

  const send = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    try {
      await generate(spaceId, {
        prompt,
        ...(target ? { toolId: target.id } : {}),
        user: { id: me.id, name: me.name },
        ...(memberAi ? { ai: memberAi } : {}),
      });
      onChange("");
      onClearTarget();
      onSent?.();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      // the field was disabled while sending and lost focus
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && target && !value) {
      onClearTarget();
    }
  };

  return (
    <div className="prompt">
      {error ? (
        <p id={errorId} className="prompt-error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}

      <form className={`prompt-box${target ? " has-target" : ""}`} onSubmit={onSubmit}>
        {target ? (
          <div className="prompt-chip">
            <PencilLine size={14} aria-hidden="true" />
            <span className="prompt-chip-text">
              Changing: <strong>{target.title || "Untitled tool"}</strong>
            </span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="Stop changing this tool"
              onClick={onClearTarget}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="prompt-row">
          <label className="sr-only" htmlFor={inputId}>
            {target ? "Describe the change" : "Ask for a tool"}
          </label>
          <textarea
            id={inputId}
            ref={ref}
            className="prompt-input"
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              target ? "Describe what should change" : "Ask for a poll, a plan, a bracket"
            }
            maxLength={LIMITS.promptLength}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="prompt-send"
            disabled={!canSend}
            aria-label={busy ? "Sending" : "Send"}
          >
            {busy ? <Spinner size={18} /> : <ArrowUp size={18} aria-hidden="true" />}
          </button>
        </div>
      </form>
      {noAi ? (
        <p className="prompt-note">
          <Info size={14} aria-hidden="true" />
          <span>
            No AI key is set up, so a request is matched to the closest starter tool. Add your own
            key in{" "}
            <button type="button" className="link-btn" onClick={onOpenSettings}>
              Settings
            </button>{" "}
            or pick from the{" "}
            <button type="button" className="link-btn" onClick={onOpenGallery}>
              starter gallery
            </button>
            .
          </span>
        </p>
      ) : (
        <p className="prompt-hint">Enter to send, Shift + Enter for a new line</p>
      )}
    </div>
  );
}
