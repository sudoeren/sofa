# Configuration

Sofa reads its settings from environment variables. In development it also loads a
`.env` file from the repository root. Every variable is optional.

## Server

| Variable                    | Default                                | Meaning                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `8787`                                 | Port for the web app, the API and the collaboration socket.                                                                                                                                               |
| `SOFA_DATA_DIR`             | `./data` (`/data` in the Docker image) | Where the SQLite database, the token secret and uploaded files are kept.                                                                                                                                  |
| `SOFA_WEB_DIR`              | `apps/web/dist` next to the server     | Built web app to serve. The Docker image sets it.                                                                                                                                                         |
| `SOFA_SPACE_TTL_HOURS`      | `0` (never)                            | Delete spaces, with their files, after this many hours without changes. Checked hourly; a space open in someone's browser is kept. Useful for public demo servers.                                        |
| `SOFA_TRUST_PROXY_HOPS`     | `0`                                    | Number of reverse proxies in front of Sofa. With 1 or more, rate limits use the client address from `X-Forwarded-For` instead of the proxy's. Coolify or Caddy alone: 1. Cloudflare in front of those: 2. |
| `SOFA_DEMO`                 | unset                                  | Set to `1` or `true` on a public demo server. The web app is told through `/api/config` so it can say that spaces are temporary and offer to export them; combine it with `SOFA_SPACE_TTL_HOURS`.         |
| `SOFA_ANALYTICS_SRC`        | unset                                  | URL of an analytics script to add to the web app page as `<script defer src="..." data-website-id="...">`. Needs `SOFA_ANALYTICS_WEBSITE_ID` too.                                                         |
| `SOFA_ANALYTICS_WEBSITE_ID` | unset                                  | Value for the `data-website-id` attribute of that script (letters, digits and dashes).                                                                                                                    |

## AI

| Variable             | Default                                                                    | Meaning                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOFA_AI_PROVIDER`   | picked automatically                                                       | `anthropic`, `openai`, `openrouter`, `openai-compatible` or `none`. When unset: Anthropic if `ANTHROPIC_API_KEY` is set, else OpenAI if `OPENAI_API_KEY` is set, else OpenRouter if `OPENROUTER_API_KEY` is set, else OpenAI-compatible if `SOFA_AI_BASE_URL` is set, else none. |
| `SOFA_AI_MODEL`      | `claude-fable-5-2`, `gpt-5`, `anthropic/claude-haiku-5.5` or `qwen3-coder` | Model name for the chosen provider. On OpenRouter use its model ids, such as `openai/gpt-5`.                                                                                                                                                                                     |
| `ANTHROPIC_API_KEY`  |                                                                            | Key for Anthropic.                                                                                                                                                                                                                                                               |
| `OPENAI_API_KEY`     |                                                                            | Key for OpenAI.                                                                                                                                                                                                                                                                  |
| `OPENROUTER_API_KEY` |                                                                            | Key for OpenRouter (`https://openrouter.ai/api/v1`).                                                                                                                                                                                                                             |
| `SOFA_AI_BASE_URL`   |                                                                            | Base URL of an OpenAI-compatible API, for example `http://localhost:11434/v1` for Ollama.                                                                                                                                                                                        |
| `SOFA_AI_API_KEY`    |                                                                            | Key for that endpoint, if it needs one.                                                                                                                                                                                                                                          |

A provider that needs a key but has none falls back to `none`. With `none`, requests are
matched to built-in tools by keyword, and members can still use their own key from the
settings dialog.

## Fixed limits

These are set in code (`packages/shared/src/api.ts`, `apps/server/src/app.ts`):

- files: 10 MB each, 50 per space
- AI requests: 10 per minute per space, one running at a time per space
- password attempts: 10 per 10 minutes per space and address
- new spaces: 30 per minute per address (spaces created from an example or an import count too)
- imports: exports up to 20 MB; uploaded files are not part of an export
