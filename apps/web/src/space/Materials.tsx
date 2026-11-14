import { colorFor, LIMITS, type Material, materialsArray, newId } from "@sofa/shared";
import clsx from "clsx";
import {
  ExternalLink,
  FileText,
  Link2,
  Paperclip,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type DragEvent, type FormEvent, useId, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Spinner } from "../components/Spinner";
import { fileUrl, previewLink, uploadFile } from "../lib/api";
import { formatBytes, hostOf, normalizeUrl, relativeTime } from "../lib/format";
import { useSpace } from "../lib/space";
import { useMaterials } from "../lib/yhooks";

type Composer = "none" | "note" | "link";

export function Materials() {
  const { doc, spaceId, me } = useSpace();
  const materials = useMaterials(doc);
  const [composer, setComposer] = useState<Composer>("none");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"" | "link" | "file">("");
  const [error, setError] = useState("");
  const [dragDepth, setDragDepth] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const linkId = useId();

  const push = (fields: Partial<Material> & Pick<Material, "kind">) => {
    const material: Material = {
      ...fields,
      id: newId(),
      authorId: me.id,
      authorName: me.name,
      createdAt: Date.now(),
    };
    doc.transact(() => materialsArray(doc).push([material]));
  };

  const remove = (id: string) => {
    doc.transact(() => {
      const array = materialsArray(doc);
      const index = array.toArray().findIndex((material) => material.id === id);
      if (index >= 0) array.delete(index, 1);
    });
    setConfirmId(null);
  };

  const addNote = (event: FormEvent) => {
    event.preventDefault();
    const text = note.trim();
    if (!text) return;
    push({ kind: "note", text: text.slice(0, LIMITS.noteLength) });
    setNote("");
    setComposer("none");
    setError("");
  };

  const addLink = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const url = normalizeUrl(link);
    if (!url) {
      setError("That does not look like a web address.");
      return;
    }
    setBusy("link");
    setError("");
    try {
      const preview = await previewLink(spaceId, url);
      push({
        kind: "link",
        url: preview.url || url,
        title: preview.title || hostOf(url),
        description: preview.description || undefined,
      });
    } catch {
      // the preview is a nicety: keep the link even when the page could not be read
      push({ kind: "link", url, title: hostOf(url) });
    } finally {
      setBusy("");
      setLink("");
      setComposer("none");
    }
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    const problems: string[] = [];
    const existing = materials.filter((material) => material.kind === "file").length;
    let room = LIMITS.filesPerSpace - existing;
    setBusy("file");
    setError("");
    for (const file of files) {
      if (file.size > LIMITS.fileBytes) {
        problems.push(`${file.name} is larger than ${formatBytes(LIMITS.fileBytes)}.`);
        continue;
      }
      if (room <= 0) {
        problems.push(`A space holds up to ${LIMITS.filesPerSpace} files.`);
        break;
      }
      try {
        const info = await uploadFile(spaceId, file);
        push({
          kind: "file",
          fileId: info.fileId,
          fileName: info.name,
          mime: info.mime,
          size: info.size,
        });
        room -= 1;
      } catch (cause) {
        problems.push(`${file.name}: ${cause instanceof Error ? cause.message : "upload failed"}`);
      }
    }
    setBusy("");
    setError(problems.join(" "));
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: file drop zone; the File button is the accessible way to upload
    <div
      className={clsx("materials", dragDepth > 0 && "is-dropping")}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (hasFiles(event)) setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragDepth(0);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="materials-actions">
        <button
          type="button"
          className={clsx("btn btn-sm", composer === "note" && "is-active")}
          aria-expanded={composer === "note"}
          onClick={() => setComposer(composer === "note" ? "none" : "note")}
        >
          <StickyNote size={15} aria-hidden="true" />
          <span>Note</span>
        </button>
        <button
          type="button"
          className={clsx("btn btn-sm", composer === "link" && "is-active")}
          aria-expanded={composer === "link"}
          onClick={() => setComposer(composer === "link" ? "none" : "link")}
        >
          <Link2 size={15} aria-hidden="true" />
          <span>Link</span>
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => fileInput.current?.click()}
          disabled={busy === "file"}
        >
          {busy === "file" ? <Spinner size={15} /> : <Upload size={15} aria-hidden="true" />}
          <span>{busy === "file" ? "Uploading" : "File"}</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload files"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void addFiles(files);
          }}
        />
      </div>

      {composer === "note" ? (
        <form className="composer" onSubmit={addNote}>
          <label className="sr-only" htmlFor={noteId}>
            Note
          </label>
          <textarea
            id={noteId}
            className="input composer-text"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Dates, ideas, constraints: anything the group should keep in mind"
            maxLength={LIMITS.noteLength}
            // biome-ignore lint/a11y/noAutofocus: opened by the user a moment ago
            autoFocus
          />
          <div className="composer-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setComposer("none")}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!note.trim()}>
              Add note
            </button>
          </div>
        </form>
      ) : null}

      {composer === "link" ? (
        <form className="composer" onSubmit={addLink} noValidate>
          <label className="sr-only" htmlFor={linkId}>
            Web address
          </label>
          <input
            id={linkId}
            className="input"
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
            maxLength={2000}
            disabled={busy === "link"}
            // biome-ignore lint/a11y/noAutofocus: opened by the user a moment ago
            autoFocus
          />
          <div className="composer-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setComposer("none")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!link.trim() || busy === "link"}
            >
              {busy === "link" ? <Spinner size={14} /> : null}
              <span>Add link</span>
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="panel-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Dismiss"
            onClick={() => setError("")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}

      {materials.length === 0 ? (
        <div className="panel-empty">
          <Paperclip size={20} aria-hidden="true" />
          <p className="panel-empty-title">Nothing collected yet</p>
          <p>
            Add notes, links and files here, or drop files anywhere on this panel. The AI reads them
            when it builds a tool.
          </p>
        </div>
      ) : (
        <ul className="material-list">
          {materials
            .slice()
            .reverse()
            .map((material) => (
              <li key={material.id} className={`material material-kind-${material.kind}`}>
                <MaterialBody material={material} spaceId={spaceId} />
                <footer className="material-foot">
                  <Avatar
                    size="sm"
                    member={{ name: material.authorName, color: colorFor(material.authorId) }}
                  />
                  <span className="material-meta">
                    {material.authorName}
                    <span aria-hidden="true"> · </span>
                    <time dateTime={new Date(material.createdAt).toISOString()}>
                      {relativeTime(material.createdAt)}
                    </time>
                  </span>
                  {confirmId === material.id ? (
                    <span className="material-confirm">
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() => setConfirmId(null)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger"
                        // biome-ignore lint/a11y/noAutofocus: confirmation the user just asked for
                        autoFocus
                        onClick={() => remove(material.id)}
                      >
                        Delete
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm material-delete"
                      aria-label="Delete material"
                      onClick={() => setConfirmId(material.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </footer>
              </li>
            ))}
        </ul>
      )}

      {dragDepth > 0 ? (
        <div className="drop-overlay" aria-hidden="true">
          <Upload size={22} />
          <span>Drop files to add them</span>
        </div>
      ) : null}
    </div>
  );
}

function MaterialBody({ material, spaceId }: { material: Material; spaceId: string }) {
  if (material.kind === "note") {
    return <p className="material-note">{material.text}</p>;
  }
  if (material.kind === "link" && material.url) {
    return (
      <a className="material-link" href={material.url} target="_blank" rel="noreferrer noopener">
        <span className="material-link-title">
          {material.title || hostOf(material.url)}
          <ExternalLink size={12} aria-hidden="true" />
        </span>
        {material.description ? (
          <span className="material-link-text">{material.description}</span>
        ) : null}
        <span className="material-link-host">{hostOf(material.url)}</span>
      </a>
    );
  }
  if (material.kind === "file" && material.fileId) {
    const url = fileUrl(material.fileId, spaceId);
    const isImage = (material.mime ?? "").startsWith("image/");
    return (
      <a className="material-file" href={url} target="_blank" rel="noreferrer noopener">
        {isImage ? (
          <img className="material-thumb" src={url} alt="" loading="lazy" />
        ) : (
          <span className="material-file-icon">
            <FileText size={18} aria-hidden="true" />
          </span>
        )}
        <span className="material-file-info">
          <span className="material-file-name">{material.fileName || "File"}</span>
          {typeof material.size === "number" ? (
            <span className="material-file-size">{formatBytes(material.size)}</span>
          ) : null}
        </span>
      </a>
    );
  }
  return material.text ? <p className="material-note">{material.text}</p> : null;
}
