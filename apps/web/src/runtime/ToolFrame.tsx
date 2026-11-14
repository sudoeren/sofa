import { type MemberInfo, type Theme, TOOL_LIMITS } from "@sofra/shared";
import { RotateCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { FrameSession } from "./session";
import { buildSrcdoc, newNonce } from "./srcdoc";
import { ToolStore } from "./store";

export type ToolFrameProps = {
  doc: Y.Doc;
  toolId: string;
  html: string;
  /** the record's version; a change reloads the frame, the state stays in the document */
  version: number;
  title?: string;
  me: MemberInfo;
  members: MemberInfo[];
  theme: Theme;
};

/** How long a frame may take to say "sofra:ready" before the host reports it. */
export const READY_TIMEOUT_MS = 8_000;
/** Unexpected navigations or hangs allowed per version before the tool is stopped. */
export const MAX_STRIKES = 2;

/**
 * Only the sandbox token that lets scripts run. Without allow-same-origin the document
 * has an opaque origin: no access to the host page, its storage, cookies or the network
 * credentials of the app. No forms, popups, top navigation, modals or downloads.
 */
const SANDBOX = "allow-scripts";

/** Explicitly deny device and capture features, whatever the browser's defaults are. */
const ALLOW =
  "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; " +
  "clipboard-read 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'; " +
  "bluetooth 'none'; midi 'none'; accelerometer 'none'; gyroscope 'none'; " +
  "magnetometer 'none'; fullscreen 'none'";

export function ToolFrame({
  doc,
  toolId,
  html,
  version,
  title,
  me,
  members,
  theme,
}: ToolFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef<FrameSession | null>(null);
  const contextRef = useRef({ me, members, theme });
  contextRef.current = { me, members, theme };

  // Mount the frame the first time it comes near the viewport and keep it from then on:
  // unmounting later would throw away whatever the tool holds outside shared state.
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = containerRef.current;
    if (mounted || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setMounted(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  const [epoch, setEpoch] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState<number>(TOOL_LIMITS.minFrameHeight);
  const [problem, setProblem] = useState<string | null>(null);

  // A new version is new code: forget what the previous one did wrong.
  const [seenVersion, setSeenVersion] = useState(version);
  if (seenVersion !== version) {
    setSeenVersion(version);
    setStrikes(0);
    setProblem(null);
  }
  const stopped = strikes >= MAX_STRIKES;

  // One boot per document load. The nonce doubles as the iframe key, so every new boot is
  // a new element with a new window; the srcdoc of a live element never changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version and epoch force a reload; theme is sent by message instead
  const boot = useMemo(() => {
    const nonce = newNonce();
    return { nonce, srcdoc: buildSrcdoc(html, { theme: contextRef.current.theme, nonce }) };
  }, [doc, toolId, html, version, epoch]);

  // Layout effect: the listener must exist before the new frame can run any script.
  useLayoutEffect(() => {
    if (!mounted || stopped) return;
    setReady(false);
    const store = new ToolStore(doc, toolId);
    const session = new FrameSession({
      store,
      nonce: boot.nonce,
      frameWindow: () => frameRef.current?.contentWindow,
      context: () => contextRef.current,
      onReady: () => setReady(true),
      onHeight: setHeight,
      onError: setProblem,
      onLost: (reason) => {
        setProblem(
          reason === "navigated"
            ? "This tool tried to open another page, which tools are not allowed to do. It was restarted."
            : "This tool stopped responding and was restarted.",
        );
        setStrikes((n) => n + 1);
        setEpoch((n) => n + 1);
      },
    });
    sessionRef.current = session;
    const onMessage = (event: MessageEvent) => session.handleWindowMessage(event);
    window.addEventListener("message", onMessage);
    const watchdog = window.setTimeout(() => {
      if (!session.ready) setProblem("This tool did not start.");
    }, READY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(watchdog);
      window.removeEventListener("message", onMessage);
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [doc, toolId, boot, mounted, stopped]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: push when the list changes
  useEffect(() => {
    sessionRef.current?.pushMembers();
  }, [members]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: push when the theme changes
  useEffect(() => {
    sessionRef.current?.pushTheme();
  }, [theme]);

  const restart = () => {
    setProblem(null);
    setStrikes(0);
    setEpoch((n) => n + 1);
  };

  return (
    <div ref={containerRef} className="rt-frame-host">
      {problem && (
        <div className="rt-strip" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <span className="rt-strip-text">{problem}</span>
          {!stopped && (
            <button
              type="button"
              className="rt-strip-btn"
              onClick={restart}
              aria-label="Reload tool"
            >
              <RotateCw size={14} aria-hidden="true" />
            </button>
          )}
          {!stopped && (
            <button
              type="button"
              className="rt-strip-btn"
              onClick={() => setProblem(null)}
              aria-label="Dismiss"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {stopped ? (
        <div className="rt-message">
          <p>This tool was stopped because it kept misbehaving.</p>
          <button type="button" className="rt-btn" onClick={restart}>
            <RotateCw size={14} aria-hidden="true" />
            Run it again
          </button>
        </div>
      ) : mounted ? (
        <iframe
          key={boot.nonce}
          ref={frameRef}
          className={ready ? "rt-frame" : "rt-frame rt-frame-loading"}
          title={title || "Tool"}
          sandbox={SANDBOX}
          allow={ALLOW}
          referrerPolicy="no-referrer"
          srcDoc={boot.srcdoc}
          style={{ height }}
          onLoad={() => sessionRef.current?.handleLoad()}
        />
      ) : (
        <div className="rt-frame-placeholder" style={{ height }} />
      )}
    </div>
  );
}
