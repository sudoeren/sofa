import { type ChatMessage, colorFor, type ToolRecord } from "@sofa/shared";
import clsx from "clsx";
import { ArrowUpRight, MessagesSquare, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Avatar } from "../components/Avatar";
import { relativeTime } from "../lib/format";
import { useSpace } from "../lib/space";
import { useChat } from "../lib/yhooks";

type Props = {
  tools: ToolRecord[];
  onShowTool: (toolId: string) => void;
};

export function Conversation({ tools, onShowTool }: Props) {
  const { doc, me } = useSpace();
  const messages = useChat(doc);
  const endRef = useRef<HTMLLIElement>(null);
  const titles = useMemo(() => new Map(tools.map((tool) => [tool.id, tool.title])), [tools]);
  const last = messages[messages.length - 1];
  const lastKey = last ? `${last.id}:${last.status}` : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest message
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lastKey]);

  if (messages.length === 0) {
    return (
      <div className="panel-empty">
        <MessagesSquare size={20} aria-hidden="true" />
        <p className="panel-empty-title">No requests yet</p>
        <p>What the group asks the AI, and what it did in reply, is kept here for everyone.</p>
      </div>
    );
  }

  return (
    <ol className="chat" aria-live="polite">
      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          mine={message.authorId === me.id}
          toolTitle={message.toolId ? titles.get(message.toolId) : undefined}
          onShowTool={onShowTool}
        />
      ))}
      <li ref={endRef} className="chat-end" aria-hidden="true" />
    </ol>
  );
}

function Message({
  message,
  mine,
  toolTitle,
  onShowTool,
}: {
  message: ChatMessage;
  mine: boolean;
  toolTitle: string | undefined;
  onShowTool: (toolId: string) => void;
}) {
  const assistant = message.role === "assistant";
  const pending = message.status === "pending";
  const failed = message.status === "error";
  const name = assistant ? "Sofa" : message.authorName || "Someone";

  return (
    <li className={clsx("msg", assistant ? "msg-assistant" : "msg-user", failed && "msg-error")}>
      {assistant ? (
        <span className="msg-ai" aria-hidden="true">
          <Sparkles size={13} />
        </span>
      ) : (
        <Avatar size="sm" member={{ name, color: colorFor(message.authorId ?? name) }} />
      )}
      <div className="msg-main">
        <div className="msg-head">
          <span className="msg-name">{mine && !assistant ? `${name} (you)` : name}</span>
          <time className="msg-time" dateTime={new Date(message.createdAt).toISOString()}>
            {relativeTime(message.createdAt)}
          </time>
        </div>
        {pending ? (
          <p className="msg-working" role="status">
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{message.text || "Working on it"}</span>
          </p>
        ) : (
          <p className="msg-text">
            {failed ? <TriangleAlert size={14} aria-hidden="true" /> : null}
            <span>{message.text || (failed ? "That did not work." : "Done.")}</span>
          </p>
        )}
        {message.toolId && toolTitle !== undefined ? (
          <button
            type="button"
            className="msg-tool"
            onClick={() => onShowTool(message.toolId as string)}
          >
            <span>{toolTitle || "Untitled tool"}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
