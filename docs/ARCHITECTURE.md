# Sofra architecture

Sofra is a self-hosted web app. A group opens a shared space, drops in notes, links and
files, and asks an AI to build the small tools it needs: a poll, an itinerary, an expense
splitter, a bracket, a seating chart, a game. Everyone edits the tools at the same time.
Asking again changes an existing tool without losing its data.

It is an independent open-source project inspired by the idea of AI-built group tools. It
must never use another product's name, logo or visual identity.

## Layout

```
packages/shared     types, Y.Doc schema helpers, REST contract, frame protocol   (source-only TS)
packages/widgets    catalog of built-in tool types: config schema, model guide   (source-only TS)
apps/server         Node: Hono REST + Hocuspocus collab socket + SQLite + AI
apps/web            Vite + React single page app
```

One process serves everything in production: REST under `/api`, the collab WebSocket at
`/collab`, and the built web app as static files. In development Vite runs on its own port
and proxies `/api` and `/collab` to the server.

## Data model

One Y.Doc per space; the document name is the space id (21 chars, unguessable). A space
can also have a password; it is then "locked" and every route, the collab socket and file
downloads need a token (see `packages/shared/src/api.ts`). The exact shape and helper functions are in
`packages/shared/src/schema.ts`. Read that file first.

- `meta`: title, createdAt
- `materials`: notes, links, files the group collected
- `chat`: requests to the AI and its replies
- `tools`: toolId -> Y.Map of ToolRecord fields plus a nested `state` Y.Map

Tool state is a flat map of JSON values. Each top-level key is last-write-wins. Tools must
store one key per independently edited thing (`vote:<memberId>`, `item:<id>`, `title`),
never one big array that two people would overwrite.

Presence uses Yjs awareness with local state `{ user: MemberInfo }`.

## Server

- `src/config.ts` environment parsing (done)
- `src/types.ts` seams: `SpaceDocs`, `FileStore`, `AiService` (done)
- core: `src/index.ts`, `src/app.ts` (Hono routes), `src/collab.ts` (Hocuspocus),
  `src/db.ts` (node:sqlite), `src/files.ts`, `src/links.ts`
- AI: `src/ai/**`, entry `src/ai/index.ts` exporting
  `createAiService(config: Config, deps: AiDeps): AiService`

REST contract: `packages/shared/src/api.ts`.

Storage is `node:sqlite` (`DatabaseSync`), no native dependency. Tables: `spaces`,
`docs` (merged Y update per space), `files`. Uploaded files live under
`<dataDir>/files/`.

The AI service writes straight into the space document through `SpaceDocs.transact`, so
every member sees a tool appear and fill in live.

## Two kinds of tools

`ToolRecord.kind` is `widget` or `html`. Both keep their shared data in the same `state`
map, so a widget can later be replaced by generated HTML that reads the same keys.

- `widget`: a built-in type from `packages/widgets` (poll, checklist, availability, table,
  expenses, itinerary, bracket, seating). The record holds `widgetType` and `config`
  (validated by the type's zod schema). The web app renders it natively with the React
  component in `apps/web/src/widgets/<Type>.tsx` (props: `WidgetProps`). Reliable, fast,
  works without any AI key: the starter gallery is the `starter` of each definition.
- `html`: anything the built-ins cannot do (games, unusual layouts). The model writes a
  full HTML document that runs in a sandboxed frame with the SDK below.

The model prefers a widget when one fits and falls back to HTML otherwise. Changing a
widget means changing its `config`; if the request goes beyond the widget, the model
rewrites it as HTML that reads the widget's documented state keys.

## AI keys

The host can configure a provider in the environment (Anthropic, OpenAI, OpenRouter, or
any OpenAI-compatible endpoint such as Ollama). A member can also save their own Anthropic,
OpenAI or OpenRouter key in their browser; it is sent in the body of each generate request (`ai`), used
for that request only, never stored or logged. A member key takes precedence. With neither,
requests are matched against starter templates by keyword.

## HTML tools and the frame SDK

An HTML tool is one complete HTML document (inline CSS and JS, no external requests). The web app
renders it in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) via `srcdoc`,
with a Content-Security-Policy that blocks all network access, and injects the SDK script
before the tool's own scripts. The frame talks to the host only through `postMessage`
(`packages/shared/src/protocol.ts`).

The SDK is the global `sofra`:

```js
sofra.ready(function () { ... })        // runs once init data has arrived (or at once if it already has)
sofra.me                                // { id, name, color }
sofra.members                           // [{ id, name, color }, ...] currently in the space
sofra.onMembers(function (members) {})  // called when the member list changes
sofra.theme                             // "light" | "dark"
sofra.onTheme(function (theme) {})

sofra.state.get(key)                    // JSON value or undefined
sofra.state.set(key, value)             // shared with everyone, applied locally at once
sofra.state.delete(key)
sofra.state.keys(prefix)                // keys, optionally only those starting with prefix
sofra.state.entries(prefix)             // [[key, value], ...]
sofra.state.all()                       // shallow copy of the whole state
sofra.state.subscribe(function (key) {})// called after any change, local or remote; key may be undefined for bulk changes
                                        // returns an unsubscribe function
sofra.id()                              // short unique id
```

Rules for tool HTML (templates and AI output follow them):

- Render from state on every change: one `render()` called in `sofra.ready` and in
  `sofra.state.subscribe`. Never keep shared data only in local variables.
- One key per independently edited thing, prefixed by kind.
- No network, no external scripts, fonts, images or styles. No `localStorage`, cookies,
  `alert`, `confirm`, `prompt`, forms that submit or links that navigate.
- Use the CSS variables the host provides in both themes (same names and values as
  `apps/web/src/styles/tokens.css`): `--bg`, `--surface`, `--surface-2`, `--text`,
  `--muted`, `--border`, `--accent`, `--accent-text`, `--accent-soft`, `--danger`, `--ok`,
  `--radius`, `--radius-sm`, `--font`, `--font-mono`.
  The SDK injects a small base stylesheet that defines them and resets margins.
- The frame resizes to its content height automatically.
- Plain text only: no emoji.

When the AI changes a tool it replaces the HTML and keeps the state, so new code must keep
reading the keys the old code wrote unless the request is to start over.

## Web app

Routes: `/` (create a space, short explanation), `/s/:spaceId` (the space).
Member identity is a random id plus a display name kept in `localStorage`; the space asks
for a name on first visit.

Space screen: header (title, members, invite link, theme, settings for the member's own AI
key), a grid of tool cards (span 1 or 2 columns, drag to reorder), a side panel with
materials and the conversation, a starter gallery, and a prompt bar.

Module boundaries in `apps/web/src`:

- `runtime/` renders one tool and owns its state plumbing. It exports
  `ToolView({ doc, toolId, me, members, theme })`, which picks the widget component or the
  sandboxed `ToolFrame`, and `useToolState(doc, toolId)` returning `{ data, set, del }`.
  It also holds the SDK source injected into frames. It does not import from the shell.
- `widgets/` one component per built-in type plus `index.ts` (registry) and `types.ts`.
  Widgets only use their props and the CSS tokens; each has its own CSS file.
- everything else is the shell (routing, space connection, layout, materials, chat).

Design: calm, warm, generous spacing, light and dark themes from `styles/tokens.css`.
Token names are a contract; do not rename them.

## Conventions

- TypeScript strict, ES modules, no default exports except where a tool requires it.
- No emoji anywhere: UI, docs, comments, commit messages. Use lucide icons in the UI.
- English for code, comments and UI text.
- Tests with vitest next to the code (`*.test.ts`).
- Only run commands for your own package (`pnpm --filter <name> ...`), prefixed with
  `nice -n 10`. Never start a root-wide build or test run.
