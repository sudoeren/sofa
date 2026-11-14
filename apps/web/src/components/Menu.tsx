import clsx from "clsx";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type Props = {
  /** accessible name of the trigger button */
  label: string;
  icon: ReactNode;
  /** receives a function that closes the menu */
  children: (close: (refocus?: boolean) => void) => ReactNode;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
};

/** Small dropdown menu: arrow keys move, Escape and outside clicks close. */
export function Menu({ label, icon, children, align = "end", onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const changeRef = useRef(onOpenChange);
  changeRef.current = onOpenChange;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    changeRef.current?.(open);
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    // a click inside a sandboxed frame never reaches this document: close when focus leaves it
    const onBlur = () => setOpen(false);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "End") next = items.length - 1;
    items[next]?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: key handling for the menu as a whole
    <div className="menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx("icon-btn", open && "is-active")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open ? (
        <div
          id={menuId}
          ref={listRef}
          role="menu"
          aria-label={label}
          className={clsx("menu-list", align === "start" && "menu-list-start")}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

type ItemProps = {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function MenuItem({ icon, children, onSelect, disabled, danger }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx("menu-item", danger && "menu-item-danger")}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="menu-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
