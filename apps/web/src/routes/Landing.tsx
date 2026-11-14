import { LIMITS } from "@sofra/shared";
import {
  ArrowRight,
  Code,
  ListChecks,
  Lock,
  MapPinned,
  Server,
  Trophy,
  Utensils,
  Wallet,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrandMark } from "../components/Brand";
import { Spinner } from "../components/Spinner";
import { ThemeToggle } from "../components/ThemeToggle";
import { createSpace } from "../lib/api";
import { setSpaceToken } from "../lib/storage";
import "../styles/landing.css";

export const REPO_URL = "https://github.com/sudoeren/sofra";

const EXAMPLES = [
  {
    icon: MapPinned,
    title: "Trip plan",
    text: "Days, places and who books what, on one page.",
    suggestion: "Lisbon in May",
  },
  {
    icon: Utensils,
    title: "Dinner poll",
    text: "Pick the place and the date without forty messages.",
    suggestion: "Friday dinner",
  },
  {
    icon: Wallet,
    title: "Splitting costs",
    text: "Log who paid and see who owes whom.",
    suggestion: "Cabin weekend",
  },
  {
    icon: Trophy,
    title: "Tournament bracket",
    text: "Seed the teams and advance the winners.",
    suggestion: "Office table tennis cup",
  },
  {
    icon: ListChecks,
    title: "Chore tracker",
    text: "Who does what this week, ticked off as it gets done.",
    suggestion: "Flat chores",
  },
];

export function Landing() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const passwordId = useId();
  const errorId = useId();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give the space a title.");
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

  return (
    <div className="landing">
      <header className="landing-top">
        <a className="brand" href="/" aria-label="Sofra home">
          <BrandMark />
          <span className="brand-name">Sofra</span>
        </a>
        <nav className="landing-nav" aria-label="Site">
          <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
            <Code size={16} aria-hidden="true" />
            <span>Source</span>
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main className="landing-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Open source, self-hosted</p>
            <h1 className="hero-title">One table for everything your group is planning.</h1>
            <p className="hero-text">
              Open a shared space, drop in the notes, links and files you already have, and ask an
              AI to build the small tool you need: a poll, an itinerary, an expense splitter, a
              bracket, a game. Everyone edits it at the same time, and asking again changes the tool
              without losing what is in it.
            </p>
            <ul className="hero-points">
              <li>
                <Server size={16} aria-hidden="true" />
                <span>Runs on your own server. Your spaces stay there.</span>
              </li>
              <li>
                <Code size={16} aria-hidden="true" />
                <span>
                  MIT licensed.{" "}
                  <a href={REPO_URL} target="_blank" rel="noreferrer">
                    Read the code on GitHub
                  </a>
                  .
                </span>
              </li>
            </ul>
          </div>

          <form className="create-card" onSubmit={onSubmit} noValidate>
            <h2 className="create-title">Create a space</h2>
            <p className="create-hint">No account needed. Share the link to invite people.</p>

            <label className="field-label" htmlFor={titleId}>
              Title
            </label>
            <input
              id={titleId}
              className="input input-lg"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Lisbon in May"
              maxLength={LIMITS.titleLength}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              required
            />

            <label className="check-row">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={(event) => setUsePassword(event.target.checked)}
              />
              <Lock size={14} aria-hidden="true" />
              <span>Protect with a password</span>
            </label>

            {usePassword ? (
              <>
                <label className="field-label" htmlFor={passwordId}>
                  Password
                </label>
                <input
                  id={passwordId}
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 4 characters"
                  minLength={4}
                  maxLength={200}
                  autoComplete="new-password"
                />
                <p className="field-hint">People will need the link and this password.</p>
              </>
            ) : null}

            {error ? (
              <p id={errorId} className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn btn-primary btn-lg create-submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              <span>{busy ? "Creating" : "Create space"}</span>
              {busy ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </form>
        </section>

        <section className="examples" aria-labelledby="examples-title">
          <h2 id="examples-title" className="section-title">
            What people build
          </h2>
          <ul className="example-grid">
            {EXAMPLES.map((example) => (
              <li key={example.title}>
                <button
                  type="button"
                  className="example-card"
                  onClick={() => {
                    setTitle(example.suggestion);
                    document.getElementById(titleId)?.focus();
                  }}
                >
                  <span className="example-icon">
                    <example.icon size={18} aria-hidden="true" />
                  </span>
                  <span className="example-title">{example.title}</span>
                  <span className="example-text">{example.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title" className="section-title">
            How it works
          </h2>
          <ol className="how-list">
            <li>
              <span className="how-step">1</span>
              <div>
                <h3>Open a space</h3>
                <p>Give it a title and send the link to your group.</p>
              </div>
            </li>
            <li>
              <span className="how-step">2</span>
              <div>
                <h3>Drop in what you have</h3>
                <p>Notes, links and files become material the AI can read.</p>
              </div>
            </li>
            <li>
              <span className="how-step">3</span>
              <div>
                <h3>Ask for a tool</h3>
                <p>
                  Describe it in a sentence, or start from a ready-made one. No AI key required.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </main>

      <footer className="landing-foot">
        <span>Sofra is open source and self-hosted.</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          github.com/sudoeren/sofra
        </a>
      </footer>
    </div>
  );
}
