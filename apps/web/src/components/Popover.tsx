import clsx from "clsx";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type TriggerProps = {
  ref: RefObject<HTMLButtonElement | null>;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
};

type Props = {
  /** accessible name of the panel */
  label: string;
  /** renders the trigger button; spread the props onto it */
  trigger: (props: TriggerProps, open: boolean) => ReactNode;
  children: (close: (refocus?: boolean) => void) => ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A small non-modal panel next to its trigger, like Menu: Escape and outside clicks close it,
 * focus moves into it on open and back to the trigger on Escape.
 */
export function Popover({ label, trigger, children, className, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const changeRef = useRef(onOpenChange);
  changeRef.current = onOpenChange;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    changeRef.current?.(open);
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    // a click inside a sandboxed tool frame never reaches this document
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) setOpen(false);
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape handling for the popover as a whole
    <div
      className="popover-root"
      ref={rootRef}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // keyboard focus left the trigger and the panel
        const next = event.relatedTarget as Node | null;
        if (open && next && rootRef.current && !rootRef.current.contains(next)) setOpen(false);
      }}
    >
      {trigger(
        {
          ref: triggerRef,
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          "aria-controls": open ? panelId : undefined,
          onClick: () => setOpen((value) => !value),
        },
        open,
      )}
      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={clsx("popover", className)}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
