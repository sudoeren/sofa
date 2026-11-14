import type { HostToTool, MemberInfo, Theme } from "@sofa/shared";
import {
  checkFrameMessage,
  clampHeight,
  isReadyFromFrame,
  publicMember,
  WriteBudget,
} from "./guard";
import type { StateChange, ToolStore } from "./store";

/** The two ends used here; MessagePort satisfies it, tests pass a synchronous pair. */
export type PortLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close?(): void;
};
export type ChannelLike = { port1: PortLike; port2: PortLike };

export type FrameWindowLike = {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
};

export type FrameContext = { me: MemberInfo; members: MemberInfo[]; theme: Theme };

export type FrameSessionOptions = {
  store: ToolStore;
  nonce: string;
  /** the iframe's contentWindow, read at use time */
  frameWindow: () => FrameWindowLike | null | undefined;
  context: () => FrameContext;
  onReady?: () => void;
  onHeight?: (height: number) => void;
  onError?: (message: string) => void;
  /** the frame left its document or stopped answering; the host should reset it */
  onLost?: (reason: "navigated" | "unresponsive") => void;
  createChannel?: () => ChannelLike;
  now?: () => number;
};

export const PING_INTERVAL_MS = 5_000;
export const PING_TIMEOUT_MS = 15_000;

type Internal = HostToTool | { type: "sofa:ping" };

/**
 * Host side of one loaded tool document. One session per iframe element; a reload makes
 * a new element and a new session.
 *
 * Handshake:
 *   1. The SDK posts "sofa:ready" to the parent window. Accepted only when event.source
 *      is this frame's window, and only once per session.
 *   2. The host answers with an empty "sofa:port" message that transfers one end of a
 *      new MessageChannel. Target origin is "*" (a sandboxed srcdoc frame has an opaque
 *      origin, nothing else can be named), so this message carries no data.
 *   3. The SDK sends "sofa:hello" with the nonce that was written into its source.
 *      Only then does the host send "sofa:init", on the port.
 *
 * After that every message in both directions uses the port. A document that replaces
 * the tool in the same frame (the tool navigated itself) keeps the same contentWindow,
 * so a source check alone would accept it; it has neither the port nor the nonce, so it
 * receives nothing and can write nothing.
 *
 * Writes: every "sofa:set"/"sofa:delete" is answered with exactly one "sofa:state"
 * for that key carrying the value the document ended up with, whether the write was
 * applied or rejected. Changes that did not come from this frame are forwarded per key.
 * The SDK relies on this one-answer-per-write rule to converge without flicker.
 */
export class FrameSession {
  private port: PortLike | null = null;
  private portSent = false;
  private established = false;
  private disposed = false;
  private loads = 0;
  private lastPong = 0;
  private lastTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly budget: WriteBudget;
  private readonly unsubscribe: () => void;
  private readonly now: () => number;

  constructor(private readonly options: FrameSessionOptions) {
    this.now = options.now ?? Date.now;
    this.budget = new WriteBudget(240, 60, this.now);
    this.unsubscribe = options.store.onChange(this.onStoreChange);
  }

  get ready(): boolean {
    return this.established;
  }

  /** Feed every window "message" event here. */
  handleWindowMessage(event: { source: unknown; data: unknown }): void {
    if (this.disposed || this.portSent) return;
    const frame = this.options.frameWindow();
    if (!isReadyFromFrame(event, frame) || !frame) return;
    this.portSent = true;
    const channel = this.options.createChannel?.() ?? (new MessageChannel() as ChannelLike);
    this.port = channel.port1;
    channel.port1.onmessage = this.onPortMessage;
    frame.postMessage({ type: "sofa:port" }, "*", [channel.port2 as unknown as Transferable]);
  }

  /**
   * Feed the iframe's "load" events here. The first one is the srcdoc. Any later one
   * means the frame now shows another document (it navigated or reloaded itself).
   */
  handleLoad(): void {
    if (this.disposed) return;
    this.loads++;
    if (this.loads > 1) this.lose("navigated");
  }

  pushMembers(): void {
    this.send({ type: "sofa:members", members: this.options.context().members.map(publicMember) });
  }

  pushTheme(): void {
    this.send({ type: "sofa:theme", theme: this.options.context().theme });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.established = false;
    this.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    if (this.port) {
      this.port.onmessage = null;
      this.port.close?.();
    }
    this.port = null;
  }

  private send(message: Internal): void {
    if (!this.established || !this.port) return;
    try {
      this.port.postMessage(message);
    } catch {
      // A value that cannot be cloned never reaches the frame; nothing else to do.
    }
  }

  private lose(reason: "navigated" | "unresponsive"): void {
    if (this.disposed) return;
    this.dispose();
    this.options.onLost?.(reason);
  }

  private readonly onPortMessage = (event: { data: unknown }): void => {
    if (this.disposed) return;
    const verdict = checkFrameMessage(event.data);

    if (!this.established) {
      if (
        verdict.kind !== "accept" ||
        verdict.message.type !== "sofa:hello" ||
        verdict.message.nonce !== this.options.nonce
      ) {
        return;
      }
      this.established = true;
      const context = this.options.context();
      this.send({
        type: "sofa:init",
        toolId: this.options.store.toolId,
        state: this.options.store.getState(),
        me: publicMember(context.me),
        members: context.members.map(publicMember),
        theme: context.theme,
      });
      this.lastPong = this.lastTick = this.now();
      this.timer = setInterval(this.tick, PING_INTERVAL_MS);
      this.options.onReady?.();
      return;
    }

    if (verdict.kind === "ignore") return;
    this.lastPong = this.now();
    const store = this.options.store;

    if (verdict.kind === "reject") {
      this.options.onError?.(`Could not save "${verdict.key.slice(0, 60)}": ${verdict.reason}`);
      this.send({ type: "sofa:state", key: verdict.key, value: store.peek(verdict.key) });
      return;
    }

    const message = verdict.message;
    switch (message.type) {
      case "sofa:set":
      case "sofa:delete": {
        const result = !this.budget.take()
          ? ({ ok: false, reason: "too many changes at once" } as const)
          : message.type === "sofa:set"
            ? store.write(message.key, message.value, this)
            : store.remove(message.key, this);
        if (!result.ok) {
          this.options.onError?.(`Could not save "${message.key.slice(0, 60)}": ${result.reason}`);
        }
        this.send({ type: "sofa:state", key: message.key, value: store.peek(message.key) });
        break;
      }
      case "sofa:resize":
        this.options.onHeight?.(clampHeight(message.height));
        break;
      case "sofa:error":
        if (message.message) this.options.onError?.(message.message);
        break;
      default:
        break; // pong (already counted), repeated ready or hello
    }
  };

  private readonly onStoreChange = (change: StateChange): void => {
    if (!this.established || change.origin === this) return;
    const store = this.options.store;
    if (change.keys === null) {
      this.send({ type: "sofa:state-all", state: store.getState() });
      return;
    }
    for (const key of change.keys) {
      this.send({ type: "sofa:state", key, value: store.peek(key) });
    }
  };

  private readonly tick = (): void => {
    const now = this.now();
    const late = now - this.lastTick > PING_INTERVAL_MS * 2;
    this.lastTick = now;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (late || hidden) {
      // Timers were throttled or the tab was in the background: start counting again.
      this.lastPong = now;
    } else if (now - this.lastPong > PING_TIMEOUT_MS) {
      this.lose("unresponsive");
      return;
    }
    this.send({ type: "sofa:ping" });
  };
}
