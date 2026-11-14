import clsx from "clsx";
import { Check, Circle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  loadOnboarding,
  type Onboarding,
  type OnboardingSteps,
  saveOnboarding,
} from "../lib/storage";

/** How long the finished checklist stays visible before it goes away. */
export const DONE_DELAY_MS = 2200;

const STEPS: { key: keyof OnboardingSteps; label: string; hint: string }[] = [
  { key: "invite", label: "Invite someone", hint: "Copy or share the link" },
  { key: "ask", label: "Ask for a tool", hint: "Use the box at the bottom" },
  {
    key: "change",
    label: "Change a tool by asking",
    hint: "In a tool's menu, pick Change with AI",
  },
];

/** Per-space progress of the checklist, kept in this browser. */
export function useOnboarding(spaceId: string) {
  const [state, setState] = useState<Onboarding>(() => loadOnboarding(spaceId));

  const update = useCallback(
    (patch: Partial<Onboarding>) => {
      setState((previous) => {
        const next = { ...previous, ...patch };
        if (
          next.invite === previous.invite &&
          next.ask === previous.ask &&
          next.change === previous.change &&
          next.dismissed === previous.dismissed
        ) {
          return previous;
        }
        saveOnboarding(spaceId, next);
        return next;
      });
    },
    [spaceId],
  );

  const mark = useCallback((step: keyof OnboardingSteps) => update({ [step]: true }), [update]);
  const dismiss = useCallback(() => update({ dismissed: true }), [update]);
  return { state, mark, dismiss };
}

type Props = {
  state: Onboarding;
  onDismiss: () => void;
};

export function GettingStarted({ state, onDismiss }: Props) {
  const allDone = state.invite && state.ask && state.change;

  useEffect(() => {
    if (!allDone || state.dismissed) return;
    const timer = window.setTimeout(onDismiss, DONE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [allDone, state.dismissed, onDismiss]);

  if (state.dismissed) return null;
  const doneCount = STEPS.filter((step) => state[step.key]).length;

  return (
    <section className={clsx("onboard", allDone && "is-done")} aria-labelledby="onboard-title">
      <header className="onboard-head">
        <h2 id="onboard-title" className="onboard-title">
          Getting started
        </h2>
        <span className="onboard-count">
          {allDone ? "All done" : `${doneCount} of ${STEPS.length}`}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn-sm onboard-close"
          aria-label="Dismiss getting started"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <ol className="onboard-steps">
        {STEPS.map((step) => {
          const done = state[step.key];
          return (
            <li key={step.key} className={clsx("onboard-step", done && "is-done")}>
              {done ? (
                <Check size={16} aria-hidden="true" className="onboard-icon" />
              ) : (
                <Circle size={16} aria-hidden="true" className="onboard-icon" />
              )}
              <span className="onboard-label">
                {step.label}
                <span className="sr-only">{done ? " (done)" : " (not done yet)"}</span>
              </span>
              <span className="onboard-hint">{step.hint}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
