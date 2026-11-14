import type { MemberInfo, ServerConfig, UserAi } from "@sofra/shared";
import { Check, Eye, EyeOff, Server } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Dialog } from "../components/Dialog";
import { clearAiSettings, cleanName, loadAiSettings, NAME_MAX, saveAiSettings } from "../lib/storage";

type Props = {
  me: MemberInfo;
  config: ServerConfig | null;
  onRename: (name: string) => void;
  onClose: () => void;
};

const MODEL_HINT: Record<UserAi["provider"], string> = {
  anthropic: "Leave empty for the server default",
  openai: "Leave empty for the server default",
};

export function SettingsDialog({ me, config, onRename, onClose }: Props) {
  const stored = loadAiSettings();
  const [name, setName] = useState(me.name);
  const [provider, setProvider] = useState<UserAi["provider"]>(stored?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(stored?.apiKey ?? "");
  const [model, setModel] = useState(stored?.model ?? "");
  const [showKey, setShowKey] = useState(false);
  const [hasStored, setHasStored] = useState(stored !== null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const nameId = useId();
  const keyId = useId();
  const modelId = useId();
  const honestId = useId();

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = cleanName(name);
    if (!cleaned || cleaned === me.name) return;
    onRename(cleaned);
    setNotice("Name updated.");
  };

  const saveKey = (event: FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (key.length < 8) {
      setError("That key looks too short.");
      setNotice("");
      return;
    }
    saveAiSettings({ provider, apiKey: key, ...(model.trim() ? { model: model.trim() } : {}) });
    setHasStored(true);
    setError("");
    setNotice("Key saved in this browser.");
  };

  const clearKey = () => {
    clearAiSettings();
    setApiKey("");
    setModel("");
    setHasStored(false);
    setError("");
    setNotice("Key removed from this browser.");
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form className="settings-section" onSubmit={saveName}>
        <h3 className="settings-heading">You</h3>
        <label className="field-label" htmlFor={nameId}>
          Display name
        </label>
        <div className="settings-row">
          <Avatar member={{ name: name || me.name, color: me.color }} />
          <input
            id={nameId}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
          />
          <button
            type="submit"
            className="btn"
            disabled={!cleanName(name) || cleanName(name) === me.name}
          >
            Save
          </button>
        </div>
      </form>

      <form className="settings-section" onSubmit={saveKey}>
        <h3 className="settings-heading">Your AI key</h3>
        <p className="settings-server">
          <Server size={15} aria-hidden="true" />
          <span>
            {config === null
              ? "Checking whether this server has its own AI provider."
              : config.aiEnabled
                ? `This server has its own AI provider${
                    config.provider ? ` (${config.provider}${config.model ? `, ${config.model}` : ""})` : ""
                  }, so a key of your own is optional. If you save one, it is used for your requests instead.`
                : "This server has no AI provider configured. Without a key, requests are matched to starter tools by keyword."}
          </span>
        </p>

        <fieldset className="segmented">
          <legend className="field-label">Provider</legend>
          <div className="segmented-options">
            {(["anthropic", "openai"] as const).map((option) => (
              <label key={option} className="segmented-option">
                <input
                  type="radio"
                  name="provider"
                  value={option}
                  checked={provider === option}
                  onChange={() => setProvider(option)}
                />
                <span>{option === "anthropic" ? "Anthropic" : "OpenAI"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field-label" htmlFor={keyId}>
          API key
        </label>
        <div className="input-with-action">
          <input
            id={keyId}
            className="input input-mono"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
            autoComplete="off"
            spellCheck={false}
            maxLength={400}
            aria-describedby={honestId}
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={showKey ? "Hide key" : "Show key"}
            aria-pressed={showKey}
            onClick={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>

        <label className="field-label" htmlFor={modelId}>
          Model <span className="field-optional">optional</span>
        </label>
        <input
          id={modelId}
          className="input input-mono"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={MODEL_HINT[provider]}
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
        />

        <p id={honestId} className="settings-honest">
          The key is kept only in this browser. It is sent with each request to this Sofra server,
          which uses it for that request and does not store it.
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="settings-actions">
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={clearKey} disabled={!hasStored}>
            Clear key
          </button>
          <button type="submit" className="btn btn-primary" disabled={!apiKey.trim()}>
            Save key
          </button>
        </div>
      </form>

      <p className="settings-notice" role="status" aria-live="polite">
        {notice ? (
          <>
            <Check size={14} aria-hidden="true" />
            <span>{notice}</span>
          </>
        ) : null}
      </p>
    </Dialog>
  );
}
