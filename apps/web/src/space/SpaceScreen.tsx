import type { ServerConfig, SpaceInfo, TemplateInfo } from "@sofa/shared";
import { CloudOff, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Dialog } from "../components/Dialog";
import { Spinner } from "../components/Spinner";
import { applyTemplate, getConfig } from "../lib/api";
import { useSpace } from "../lib/space";
import { loadAiSettings, subscribeAiSettings } from "../lib/storage";
import { useTheme } from "../lib/theme";
import { setSpaceTitle } from "../lib/tools";
import { useChat, useMaterials, useSpaceTitle, useTools } from "../lib/yhooks";
import { Header } from "./Header";
import { PromptBar } from "./PromptBar";
import { SettingsDialog } from "./SettingsDialog";
import { type PanelTab, SidePanel } from "./SidePanel";
import { ToolGrid } from "./ToolGrid";
import { EXAMPLE_PROMPTS, TemplateList } from "./templates";
import "../styles/space.css";

const WIDE = "(min-width: 900px)";

type Props = {
  info: SpaceInfo;
  onRename: (name: string) => void;
};

export function SpaceScreen({ info, onRename }: Props) {
  const { doc, spaceId, status, me, members } = useSpace();
  const { theme } = useTheme();
  const tools = useTools(doc);
  const materials = useMaterials(doc);
  const chat = useChat(doc);
  const liveTitle = useSpaceTitle(doc);
  const title = liveTitle || info.title;
  const memberAi = useSyncExternalStore(subscribeAiSettings, loadAiSettings);

  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia(WIDE).matches);
  const [panelTab, setPanelTab] = useState<PanelTab>("materials");
  const [draft, setDraft] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // tool ids that existed when this member last sent a request; the first new one is shown
  const knownToolsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    document.title = title ? `${title} · Sofa` : "Sofa";
    return () => {
      document.title = "Sofa";
    };
  }, [title]);

  useEffect(() => {
    const controller = new AbortController();
    getConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        // the gallery and the AI note stay hidden; everything else works
      });
    return () => controller.abort();
  }, []);

  const target = useMemo(() => {
    const tool = targetId ? tools.find((item) => item.id === targetId) : undefined;
    return tool ? { id: tool.id, title: tool.title } : null;
  }, [targetId, tools]);

  // the targeted tool was deleted by someone
  useEffect(() => {
    if (targetId && !target) setTargetId(null);
  }, [targetId, target]);

  const closePanelIfSheet = useCallback(() => {
    if (!window.matchMedia(WIDE).matches) setPanelOpen(false);
  }, []);

  const showTool = useCallback(
    (toolId: string) => {
      closePanelIfSheet();
      setHighlightId(toolId);
    },
    [closePanelIfSheet],
  );

  // bring the tool created by this member's request into view as soon as its card appears
  useEffect(() => {
    const known = knownToolsRef.current;
    if (!known) return;
    const fresh = tools.find((tool) => !known.has(tool.id));
    if (fresh) {
      knownToolsRef.current = null;
      setHighlightId(fresh.id);
    }
  }, [tools]);

  // scroll to the highlighted tool once its card exists (a new tool arrives over the socket)
  const highlightPresent = highlightId !== null && tools.some((tool) => tool.id === highlightId);
  useEffect(() => {
    if (!highlightId || !highlightPresent) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`tool-${highlightId}`)
        ?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightId(null), 1800);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightId, highlightPresent]);

  const changeWithAi = useCallback((toolId: string) => {
    setTargetId(toolId);
    requestAnimationFrame(() => promptRef.current?.focus());
  }, []);

  const fillPrompt = (text: string) => {
    setDraft(text);
    setGalleryOpen(false);
    requestAnimationFrame(() => promptRef.current?.focus());
  };

  const pickTemplate = async (template: TemplateInfo) => {
    if (templateBusy) return;
    setTemplateBusy(template.id);
    setTemplateError("");
    try {
      const { toolId } = await applyTemplate(spaceId, template.id, { id: me.id, name: me.name });
      setGalleryOpen(false);
      setHighlightId(toolId);
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : "Could not add that tool.");
    } finally {
      setTemplateBusy(null);
    }
  };

  const pendingCount = chat.filter((message) => message.status === "pending").length;
  const templates = config?.templates ?? [];

  return (
    <div className="space">
      <Header
        title={title}
        locked={info.locked}
        status={status}
        me={me}
        members={members}
        panelOpen={panelOpen}
        onRenameSpace={(next) => setSpaceTitle(doc, next)}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGallery={() => setGalleryOpen(true)}
      />

      {status !== "connected" ? (
        <div className="banner" role="status">
          {status === "connecting" ? (
            <Spinner size={15} />
          ) : (
            <CloudOff size={15} aria-hidden="true" />
          )}
          <span>
            {status === "connecting"
              ? "Reconnecting. You can keep working; changes are sent when the connection is back."
              : "You are offline. Changes are kept here and sent when the connection is back."}
          </span>
        </div>
      ) : null}

      <div className="space-body">
        <main className="space-main">
          <div className="space-scroll" ref={scrollRef}>
            {tools.length === 0 ? (
              <section className="empty" aria-labelledby="empty-title">
                <span className="empty-mark" aria-hidden="true">
                  <Sparkles size={22} />
                </span>
                <h2 id="empty-title" className="empty-title">
                  The table is set. What do you need on it?
                </h2>
                <p className="empty-text">
                  Describe a tool in the box below, or start from one of these. Everyone in the
                  space can use it right away.
                </p>

                {templates.length > 0 ? (
                  <>
                    <h3 className="empty-heading">Start from a ready-made tool</h3>
                    <TemplateList
                      templates={templates}
                      busyId={templateBusy}
                      onPick={pickTemplate}
                    />
                  </>
                ) : null}
                {templateError ? (
                  <p className="form-error" role="alert">
                    {templateError}
                  </p>
                ) : null}

                <h3 className="empty-heading">Or ask for something like</h3>
                <ul className="prompt-examples">
                  {EXAMPLE_PROMPTS.map((text) => (
                    <li key={text}>
                      <button
                        type="button"
                        className="prompt-example"
                        onClick={() => fillPrompt(text)}
                      >
                        {text}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <>
                <ToolGrid
                  doc={doc}
                  tools={tools}
                  me={me}
                  members={members}
                  theme={theme}
                  targetId={target?.id ?? null}
                  highlightId={highlightId}
                  onChangeWithAi={changeWithAi}
                />
                <div className="grid-foot">
                  <button
                    type="button"
                    className="btn btn-dashed"
                    onClick={() => setGalleryOpen(true)}
                  >
                    <Plus size={16} aria-hidden="true" />
                    <span>Add tool</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <PromptBar
            spaceId={spaceId}
            me={me}
            value={draft}
            onChange={setDraft}
            target={target}
            onClearTarget={() => setTargetId(null)}
            serverAi={config ? config.aiEnabled : null}
            memberAi={memberAi}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGallery={() => setGalleryOpen(true)}
            onSent={() => {
              setPanelTab("conversation");
              if (!targetId) knownToolsRef.current = new Set(tools.map((tool) => tool.id));
            }}
            inputRef={promptRef}
          />
        </main>

        <SidePanel
          open={panelOpen}
          tab={panelTab}
          materialCount={materials.length}
          pendingCount={pendingCount}
          tools={tools}
          onTab={setPanelTab}
          onClose={() => setPanelOpen(false)}
          onShowTool={showTool}
        />
      </div>

      {galleryOpen ? (
        <Dialog
          title="Add a tool"
          description="Ready-made tools work right away, without an AI key. You can change them later by asking."
          size="lg"
          onClose={() => setGalleryOpen(false)}
        >
          {templates.length > 0 ? (
            <TemplateList templates={templates} busyId={templateBusy} onPick={pickTemplate} />
          ) : (
            <p className="muted">
              {config
                ? "This server offers no starter tools."
                : "The starter tools could not be loaded."}
            </p>
          )}
          {templateError ? (
            <p className="form-error" role="alert">
              {templateError}
            </p>
          ) : null}
          <h3 className="empty-heading">Or ask for something like</h3>
          <ul className="prompt-examples">
            {EXAMPLE_PROMPTS.map((text) => (
              <li key={text}>
                <button type="button" className="prompt-example" onClick={() => fillPrompt(text)}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          me={me}
          config={config}
          onRename={onRename}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
