import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onCommit: (value: string) => void;
  /** accessible name, e.g. "Space title" */
  label: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
};

/**
 * Text that is edited in place. Commits on Enter or blur, Escape restores the value.
 * While the field is not focused it follows remote changes.
 */
export function InlineEdit({ value, onCommit, label, placeholder, maxLength, className }: Props) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  return (
    <input
      className={clsx("inline-edit", className)}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      spellCheck={false}
      autoComplete="off"
      size={1}
      onFocus={() => {
        cancelled.current = false;
        setEditing(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setEditing(false);
        const next = draft.trim();
        if (cancelled.current || !next || next === value) {
          setDraft(value);
          return;
        }
        onCommit(next);
      }}
    />
  );
}
