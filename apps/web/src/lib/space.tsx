import { HocuspocusProvider } from "@hocuspocus/provider";
import { COLLAB_PATH, type MemberInfo } from "@sofra/shared";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type SpaceContextValue = {
  spaceId: string;
  doc: Y.Doc;
  status: ConnectionStatus;
  /** true once the first sync with the server has completed */
  synced: boolean;
  me: MemberInfo;
  /** people currently connected, me first, one entry per member id */
  members: MemberInfo[];
};

const SpaceContext = createContext<SpaceContextValue | null>(null);

export function useSpace(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) throw new Error("useSpace must be used inside SpaceProvider");
  return value;
}

export function collabUrl(location: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${COLLAB_PATH}`;
}

function isMember(value: unknown): value is MemberInfo {
  if (!value || typeof value !== "object") return false;
  const member = value as Partial<MemberInfo>;
  return (
    typeof member.id === "string" &&
    member.id.length > 0 &&
    typeof member.name === "string" &&
    typeof member.color === "string"
  );
}

/** One entry per member id (a person can have several tabs open), me first, then by name. */
export function membersFromStates(states: Iterable<unknown>, me: MemberInfo): MemberInfo[] {
  const byId = new Map<string, MemberInfo>();
  for (const state of states) {
    const user = (state as { user?: unknown } | null | undefined)?.user;
    if (isMember(user) && user.id !== me.id && !byId.has(user.id)) {
      byId.set(user.id, { id: user.id, name: user.name, color: user.color });
    }
  }
  const others = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  return [me, ...others];
}

function sameMembers(a: MemberInfo[], b: MemberInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every((member, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        other.id === member.id &&
        other.name === member.name &&
        other.color === member.color
      );
    })
  );
}

type Connection = { doc: Y.Doc; provider: HocuspocusProvider };

type Props = {
  spaceId: string;
  /** token of a locked space */
  token: string | null;
  me: MemberInfo;
  /** the server refused the token: the caller should ask for the password again */
  onAuthFailed?: () => void;
  /** shown until the first sync has completed */
  fallback?: ReactNode;
  children: ReactNode;
};

/** Owns the Y.Doc and the single collab connection of a space. */
export function SpaceProvider({ spaceId, token, me, onAuthFailed, fallback, children }: Props) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [members, setMembers] = useState<MemberInfo[]>([me]);

  const meRef = useRef(me);
  meRef.current = me;
  const authFailedRef = useRef(onAuthFailed);
  authFailedRef.current = onAuthFailed;

  useEffect(() => {
    let alive = true;
    const doc = new Y.Doc();
    let current: HocuspocusProvider | undefined;
    const refreshMembers = () => {
      if (!alive) return;
      const awareness = current?.awareness;
      const states = awareness ? awareness.getStates().values() : [];
      const next = membersFromStates(states, meRef.current);
      setMembers((previous) => (sameMembers(previous, next) ? previous : next));
    };
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: spaceId,
      document: doc,
      token: token ?? "",
      onStatus: ({ status: next }) => {
        if (alive) setStatus(next as ConnectionStatus);
      },
      onSynced: () => {
        if (alive) setSynced(true);
      },
      onAuthenticationFailed: () => {
        if (alive) authFailedRef.current?.();
      },
      onAwarenessChange: refreshMembers,
    });
    current = provider;
    provider.setAwarenessField("user", meRef.current);
    setConnection({ doc, provider });
    setStatus("connecting");
    setSynced(false);
    refreshMembers();

    return () => {
      alive = false;
      provider.destroy();
      doc.destroy();
      setConnection(null);
    };
  }, [spaceId, token]);

  // keep presence in step with a renamed member
  useEffect(() => {
    if (!connection) return;
    connection.provider.setAwarenessField("user", me);
    const awareness = connection.provider.awareness;
    setMembers(membersFromStates(awareness ? awareness.getStates().values() : [], me));
  }, [connection, me]);

  const value = useMemo<SpaceContextValue | null>(
    () =>
      connection ? { spaceId, doc: connection.doc, status, synced, me, members } : null,
    [connection, spaceId, status, synced, me, members],
  );

  if (!value || !synced) return <>{fallback ?? null}</>;
  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

/** For tests and stories: provide a space without a network connection. */
export function StaticSpaceProvider({
  value,
  children,
}: {
  value: SpaceContextValue;
  children: ReactNode;
}) {
  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}
