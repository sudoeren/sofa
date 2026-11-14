import type { ExampleInfo } from "@sofa/shared";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "../../components/Spinner";
import { importSpace, openExample } from "../../lib/api";
import { identityRef, setSpaceToken } from "../../lib/storage";
import { readSpaceFile } from "../../lib/transfer";

/** "Or open an example": one text button per example the server offers. */
export function Examples({ examples }: { examples: ExampleInfo[] }) {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const headingId = useId();

  if (examples.length === 0) return null;

  const open = async (example: ExampleInfo) => {
    if (busyId) return;
    setBusyId(example.id);
    setError("");
    try {
      const space = await openExample(example.id, identityRef());
      if (space.token) setSpaceToken(space.id, space.token);
      navigate(`/s/${space.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that example.");
      setBusyId(null);
    }
  };

  return (
    <section className="examples" aria-labelledby={headingId}>
      <h2 id={headingId} className="examples-heading">
        Or open an example
      </h2>
      <ul className="examples-list">
        {examples.map((example) => {
          const busy = busyId === example.id;
          return (
            <li key={example.id}>
              <button
                type="button"
                className="example"
                onClick={() => open(example)}
                disabled={busyId !== null}
                aria-busy={busy || undefined}
              >
                <span className="example-title">
                  {example.title}
                  {busy ? <Spinner size={13} /> : null}
                </span>
                <span className="example-text">{example.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="start-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** A small link that imports a .sofa.json file as a new space. */
export function ImportSpace() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // allow picking the same file again after an error
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await readSpaceFile(file);
      const space = await importSpace(data);
      if (space.token) setSpaceToken(space.id, space.token);
      navigate(`/s/${space.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that file.");
      setBusy(false);
    }
  };

  return (
    <div className="import">
      <label className="sr-only" htmlFor={inputId}>
        Sofa space file
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        onChange={onFile}
      />
      <button
        type="button"
        className="import-link"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Spinner size={13} /> : null}
        <span>{busy ? "Importing" : "Import a space"}</span>
      </button>
      {error ? (
        <p className="start-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
