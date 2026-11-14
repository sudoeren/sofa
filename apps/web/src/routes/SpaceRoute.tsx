import { isSpaceId, type MemberInfo, type SpaceInfo } from "@sofa/shared";
import { CloudOff, Lock, UserRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useParams } from "react-router-dom";
import { Spinner } from "../components/Spinner";
import { ApiError, getSpace, unlockSpace } from "../lib/api";
import { SpaceProvider } from "../lib/space";
import {
  clearSpaceToken,
  getSpaceToken,
  loadIdentity,
  NAME_MAX,
  saveIdentity,
  setSpaceToken,
} from "../lib/storage";
import { SpaceScreen } from "../space/SpaceScreen";
import { Gate, GateCard } from "./Gate";
import { NotFound } from "./NotFound";

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ready"; info: SpaceInfo };

export function SpaceRoute() {
  const { spaceId = "" } = useParams();
  // remount per space so no state leaks from one space to the next
  return <SpaceEntry key={spaceId} spaceId={spaceId} />;
}

function SpaceEntry({ spaceId }: { spaceId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [token, setToken] = useState<string | null>(() => getSpaceToken(spaceId));
  const [me, setMe] = useState<MemberInfo | null>(() => loadIdentity());
  const [lockNotice, setLockNotice] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt triggers a retry
  useEffect(() => {
    if (!isSpaceId(spaceId)) {
      setLoad({ state: "missing" });
      return;
    }
    const controller = new AbortController();
    setLoad({ state: "loading" });
    getSpace(spaceId, controller.signal)
      .then((info) => setLoad({ state: "ready", info }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) setLoad({ state: "missing" });
        else
          setLoad({
            state: "error",
            message: cause instanceof Error ? cause.message : "Could not open the space.",
          });
      });
    return () => controller.abort();
  }, [spaceId, attempt]);

  const onAuthFailed = useCallback(() => {
    clearSpaceToken(spaceId);
    setToken(null);
    setLockNotice("Your access to this space expired. Enter the password again.");
  }, [spaceId]);

  const onRename = useCallback((name: string) => setMe(saveIdentity(name)), []);

  if (load.state === "loading") {
    return (
      <Gate>
        <div className="gate-loading" role="status">
          <Spinner size={20} />
          <span>Opening the space</span>
        </div>
      </Gate>
    );
  }
  if (load.state === "missing") return <NotFound space />;
  if (load.state === "error") {
    return (
      <Gate>
        <GateCard
          icon={<CloudOff size={22} aria-hidden="true" />}
          title="Could not open the space"
          text={load.message}
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </GateCard>
      </Gate>
    );
  }

  const { info } = load;
  if (info.locked && !token) {
    return (
      <UnlockForm
        spaceId={spaceId}
        title={info.title}
        notice={lockNotice}
        onUnlocked={(next) => {
          setSpaceToken(spaceId, next);
          setLockNotice("");
          setToken(next);
        }}
      />
    );
  }
  if (!me) return <NameForm title={info.title} onSaved={setMe} />;

  return (
    <SpaceProvider
      spaceId={spaceId}
      token={info.locked ? token : null}
      me={me}
      onAuthFailed={info.locked ? onAuthFailed : undefined}
      fallback={
        <Gate>
          <div className="gate-loading" role="status">
            <Spinner size={20} />
            <span>Connecting to {info.title}</span>
          </div>
        </Gate>
      }
    >
      <SpaceScreen info={info} onRename={onRename} />
    </SpaceProvider>
  );
}

function UnlockForm({
  spaceId,
  title,
  notice,
  onUnlocked,
}: {
  spaceId: string;
  title: string;
  notice: string;
  onUnlocked: (token: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const errorId = useId();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const { token } = await unlockSpace(spaceId, password);
      onUnlocked(token);
    } catch (cause) {
      setBusy(false);
      if (cause instanceof ApiError && cause.status === 403)
        setError("That password is not right.");
      else setError(cause instanceof Error ? cause.message : "Could not unlock the space.");
    }
  };

  return (
    <Gate>
      <GateCard
        icon={<Lock size={22} aria-hidden="true" />}
        title={title || "Locked space"}
        text={notice || "This space is protected with a password."}
      >
        <form className="gate-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor={inputId}>
            Password
          </label>
          <input
            id={inputId}
            className="input input-lg"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            // biome-ignore lint/a11y/noAutofocus: the only field on the page
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error ? (
            <p id={errorId} className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !password}>
            {busy ? <Spinner /> : null}
            <span>Unlock</span>
          </button>
        </form>
      </GateCard>
    </Gate>
  );
}

function NameForm({ title, onSaved }: { title: string; onSaved: (me: MemberInfo) => void }) {
  const [name, setName] = useState("");
  const inputId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSaved(saveIdentity(name));
  };

  return (
    <Gate>
      <GateCard
        icon={<UserRound size={22} aria-hidden="true" />}
        title="What should we call you?"
        text={
          <>
            You are joining <strong>{title}</strong>. Your name is shown to the others in the space
            and is kept in this browser.
          </>
        }
      >
        <form className="gate-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor={inputId}>
            Your name
          </label>
          <input
            id={inputId}
            className="input input-lg"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            placeholder="Deniz"
            // biome-ignore lint/a11y/noAutofocus: the only field on the page
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-lg" disabled={!name.trim()}>
            Join the space
          </button>
        </form>
      </GateCard>
    </Gate>
  );
}
