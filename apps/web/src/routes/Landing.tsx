import { LIMITS, type ServerConfig } from "@sofa/shared";
import { ArrowRight, Check, Copy, Lock } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { Credit } from "../components/Credit";
import { DemoNotice } from "../components/DemoNotice";
import { Spinner } from "../components/Spinner";
import { ThemeToggle } from "../components/ThemeToggle";
import { createSpace, getConfig } from "../lib/api";
import { setSpaceToken } from "../lib/storage";
import { DemoSpace } from "./landing/DemoSpace";
import { Showcase } from "./landing/Showcase";
import { Examples, ImportSpace } from "./landing/StartOptions";
import "../styles/landing.css";

export const REPO_URL = "https://github.com/sudoeren/sofa";

const INSTALL = `git clone ${REPO_URL}
cd sofa && cp .env.example .env
docker compose up -d`;

const STEPS = [
  {
    title: "Name a space",
    text: "Send the link to your group. Nobody signs up.",
  },
  {
    title: "Add what you know",
    text: "Notes, links, files. The AI reads them before it builds anything.",
  },
  {
    title: "Ask for anything",
    text: "It appears for everyone at once. Ask again to change it; nothing anyone entered is lost.",
  },
];

const PROVIDERS = ["Anthropic", "OpenAI", "OpenRouter", "Ollama and other local models"];

export function Landing() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [config, setConfig] = useState<ServerConfig | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        // no examples and no demo notice; creating a space still works
      });
    return () => controller.abort();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give the space a name.");
      titleRef.current?.focus();
      return;
    }
    if (usePassword && password.length < 4) {
      setError("The password needs at least 4 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const space = await createSpace({
        title: cleanTitle,
        ...(usePassword ? { password } : {}),
      });
      if (space.token) setSpaceToken(space.id, space.token);
      navigate(`/s/${space.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the space.");
      setBusy(false);
    }
  };

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can be blocked; the text is selectable anyway */
    }
  };

  const startForm = (
    <form className="start" onSubmit={onSubmit} noValidate>
      <div className="start-row">
        <label className="sr-only" htmlFor={titleId}>
          Space name
        </label>
        <input
          ref={titleRef}
          id={titleId}
          className="start-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Name your space, e.g. Lisbon in May"
          maxLength={LIMITS.titleLength}
          autoComplete="off"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="start-btn" disabled={busy}>
          {busy ? <Spinner size={16} /> : null}
          <span>Create space</span>
          {busy ? null : <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="start-extra">
        <label className="start-check">
          <input
            type="checkbox"
            checked={usePassword}
            onChange={(event) => setUsePassword(event.target.checked)}
          />
          <Lock size={13} aria-hidden="true" />
          <span>Password</span>
        </label>
        {usePassword ? (
          <>
            <label className="sr-only" htmlFor={passwordId}>
              Password
            </label>
            <input
              id={passwordId}
              className="start-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 4 characters"
              autoComplete="new-password"
              maxLength={200}
            />
          </>
        ) : (
          <span className="start-hint">No account needed. Share the link to invite people.</span>
        )}
      </div>
      {error ? (
        <p className="start-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );

  return (
    <div className="lp">
      <DemoNotice config={config} />
      <header className="lp-nav">
        <a className="brand" href="/" aria-label="Sofa home">
          <Wordmark />
        </a>
        <nav className="lp-links" aria-label="Site">
          <a href="#tools">Tools</a>
          <a href="#self-host">Self-host</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <p className="lp-eyebrow">Free and open source</p>
          <h1 className="lp-title">
            Stop planning <br />
            in the group chat.
          </h1>
          <p className="lp-lead">
            Open a space and ask for what your group needs: a poll, a trip plan, a cost splitter, a
            small game. It appears for everyone at once, and asking again changes it.
          </p>
          {startForm}
          <Examples examples={config?.examples ?? []} />
          <ImportSpace />
        </section>

        <section className="lp-demo" aria-label="Preview">
          <DemoSpace />
          <p className="lp-caption">
            This is the real app, running in your browser. Go ahead and vote.
          </p>
        </section>

        <section className="lp-section" id="how">
          <h2 className="lp-h2">Three steps, no accounts</h2>
          <ol className="lp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="lp-step-num">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section" id="tools">
          <h2 className="lp-h2">Ready-made tools, or one written for you</h2>
          <p className="lp-sub">
            Eight built-in tools work without any AI key. Ask for something else and the AI writes
            it from scratch, in a sandbox with no network access.
          </p>
          <Showcase />
        </section>

        <section className="lp-section lp-split" id="self-host">
          <div>
            <h2 className="lp-h2">Yours to run</h2>
            <p className="lp-sub">
              One container and one SQLite file. Spaces, files and conversations stay on your
              server. Bring a key from any of these, or run without one:
            </p>
            <ul className="lp-list">
              {PROVIDERS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="lp-sub">
              Members can also use their own key. It stays in their browser and is never stored on
              the server.
            </p>
          </div>
          <div className="lp-code">
            <div className="lp-code-head">
              <span>Terminal</span>
              <button type="button" className="lp-copy" onClick={copyInstall}>
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <pre>
              <code>{INSTALL}</code>
            </pre>
          </div>
        </section>

        <section className="lp-cta">
          <h2 className="lp-h2">Get everyone on the sofa.</h2>
          <p className="lp-sub">Start a space, share one link, plan together.</p>
          <button
            type="button"
            className="start-btn"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              titleRef.current?.focus({ preventScroll: true });
            }}
          >
            <span>Create a space</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </section>
      </main>

      <footer className="lp-foot">
        <Credit />
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
