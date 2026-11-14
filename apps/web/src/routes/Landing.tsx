import { LIMITS } from "@sofra/shared";
import { ArrowRight, Check, Copy, Lock } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { Spinner } from "../components/Spinner";
import { ThemeToggle } from "../components/ThemeToggle";
import { createSpace } from "../lib/api";
import { setSpaceToken } from "../lib/storage";
import { DemoSpace } from "./landing/DemoSpace";
import { Showcase } from "./landing/Showcase";
import "../styles/landing.css";

export const REPO_URL = "https://github.com/sudoeren/sofra";

const INSTALL = `git clone ${REPO_URL}
cd sofra && cp .env.example .env
docker compose up -d`;

const STEPS = [
  {
    title: "Open a space",
    text: "Give it a name and send the link to your group. No accounts.",
  },
  {
    title: "Drop in what you have",
    text: "Notes, links and files. The AI reads them when it builds something.",
  },
  {
    title: "Ask for a tool",
    text: "Everyone uses it at once. Ask again to change it; what people entered stays.",
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
      <header className="lp-nav">
        <a className="brand" href="/" aria-label="Sofra home">
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
          <p className="lp-eyebrow">Open source and self-hosted</p>
          <h1 className="lp-title">
            Ask for the tool.
            <br />
            Your whole group gets it.
          </h1>
          <p className="lp-lead">
            A shared space where anyone can ask an AI for a poll, a trip plan, a cost splitter or a
            small game, and everyone uses it at the same time.
          </p>
          {startForm}
        </section>

        <section className="lp-demo" aria-label="Preview">
          <DemoSpace />
          <p className="lp-caption">
            A live preview running in your browser. Vote in the poll, add an expense.
          </p>
        </section>

        <section className="lp-section" id="how">
          <h2 className="lp-h2">How it works</h2>
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
          <h2 className="lp-h2">Eight built-in tools, and anything else</h2>
          <p className="lp-sub">
            Built-in tools work without any AI key. For everything else the AI writes a new tool
            that runs sandboxed, without network access.
          </p>
          <Showcase />
        </section>

        <section className="lp-section lp-split" id="self-host">
          <div>
            <h2 className="lp-h2">Runs on your server</h2>
            <p className="lp-sub">
              One container, one SQLite file. Your spaces, files and conversations stay with you.
              Bring a key from any of these, or none at all:
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
          <h2 className="lp-h2">Set the table.</h2>
          <p className="lp-sub">Start a space now, invite your group in one link.</p>
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
        <span>Sofra is MIT licensed.</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
