import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";

/** Centered single-card page used before a space is open (loading, unlock, name, errors). */
export function Gate({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <header className="gate-top">
        <Link className="brand" to="/" aria-label="Sofra home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main className="gate-main">{children}</main>
    </div>
  );
}

export function GateCard({
  icon,
  title,
  text,
  children,
}: {
  icon?: ReactNode;
  title: string;
  text?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="gate-card">
      {icon ? <div className="gate-icon">{icon}</div> : null}
      <h1 className="gate-title">{title}</h1>
      {text ? <p className="gate-text">{text}</p> : null}
      {children}
    </section>
  );
}
