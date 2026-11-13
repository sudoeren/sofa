import type { JsonValue, MemberInfo, ToolState } from "@sofra/shared";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Small helpers shared by all built-in widgets. Signatures are stable: add new helpers
 * instead of changing these.
 */

/** Up to two initials of a display name, upper-case. "?" when the name is empty. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Colored circle with initials. `member` only needs a name; without a color (a member who
 * left the space) the circle is neutral.
 */
export function Avatar({
  member,
  size = 22,
}: {
  member: { name: string; color?: string };
  size?: number;
}) {
  const name = typeof member.name === "string" ? member.name : "";
  return (
    <span
      className="w-avatar"
      title={name}
      role="img"
      aria-label={name || "Unknown member"}
      style={{
        background: member.color || "var(--muted)",
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.5)),
      }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Text that is edited in place. Commits on blur or Enter (only when the trimmed text
 * changed), reverts on Escape. While the input has focus, a remote change of `value` does
 * not replace what the user is typing.
 */
export function InlineEdit({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
  maxLength,
  required,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  maxLength?: number;
  /** when true, an empty text is not committed; the previous value comes back */
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelled.current = true;
      event.currentTarget.blur();
    }
  }

  return (
    <input
      type="text"
      className={className ? `w-inline-edit ${className}` : "w-inline-edit"}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focused.current = true;
        cancelled.current = false;
      }}
      onBlur={() => {
        focused.current = false;
        const next = draft.trim();
        if (cancelled.current || next === value.trim() || (required && next === "")) {
          cancelled.current = false;
          setDraft(value);
          return;
        }
        setDraft(next);
        onCommit(next);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

let keyCounter = 0;

/** Short unique id for state keys. Lower-case letters and digits only (no ":"). */
export function newKeyId(): string {
  keyCounter = (keyCounter + 1) % 1296;
  const random = Math.floor(Math.random() * 36 ** 5)
    .toString(36)
    .padStart(5, "0");
  return Date.now().toString(36) + keyCounter.toString(36).padStart(2, "0") + random;
}

/** Entries whose key starts with `prefix`, as [key without the prefix, value], sorted by id. */
export function entriesWithPrefix(data: ToolState, prefix: string): [string, JsonValue][] {
  const out: [string, JsonValue][] = [];
  for (const key of Object.keys(data)) {
    if (key.length > prefix.length && key.startsWith(prefix)) {
      const value = data[key];
      if (value !== undefined) out.push([key.slice(prefix.length), value]);
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Display name of a member currently in the space, or `fallback` (e.g. a stored name). */
export function memberName(members: MemberInfo[], id: string, fallback: string): string {
  return members.find((member) => member.id === id)?.name ?? fallback;
}

/** A JSON value as a plain object, or undefined for anything else (arrays, null, scalars). */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Pick a member with the platform's own picker: `children` is what is shown, an invisible
 * native select lies on top of it. A stored member who left the space stays selectable.
 */
export function MemberPick({
  value,
  members,
  onChange,
  ariaLabel,
  emptyLabel = "Nobody",
  className,
  style,
  children,
}: {
  value: { id: string; name: string } | null;
  members: MemberInfo[];
  onChange: (next: { id: string; name: string } | null) => void;
  ariaLabel: string;
  emptyLabel?: string;
  className?: string;
  /** merged over the wrapper's default inline style */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const away = value && !members.some((member) => member.id === value.id) ? value : null;
  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        maxWidth: "100%",
        borderRadius: "var(--radius-sm)",
        outline: focused ? "2px solid var(--accent)" : undefined,
        outlineOffset: 1,
        ...style,
      }}
    >
      {children}
      <select
        aria-label={ariaLabel}
        value={value ? (away ? "away" : value.id) : ""}
        onChange={(event) => {
          const id = event.target.value;
          if (id === "") return onChange(null);
          const member = members.find((m) => m.id === id);
          if (member) onChange({ id: member.id, name: member.name });
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <option value="">{emptyLabel}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
        {away ? <option value="away">{away.name || "Someone"} (away)</option> : null}
      </select>
    </span>
  );
}
