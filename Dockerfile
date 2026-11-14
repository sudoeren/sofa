# syntax=docker/dockerfile:1

# Sofra needs Node >= 22.5 (node:sqlite). There are no native modules, so the slim image
# is enough for both building and running.
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
WORKDIR /repo

# corepack reads the pnpm version from "packageManager" in package.json.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

# Manifests first, so the dependency layer is reused when only source files change.
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/widgets/package.json packages/widgets/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# vite build for the web app, then tsup for the server.
RUN pnpm build

# The server bundle inlines the workspace packages and keeps every other dependency
# external, so the runtime needs the server's production node_modules and nothing else.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @sofra/server deploy --prod --legacy /deploy


FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    SOFRA_DATA_DIR=/data \
    SOFRA_WEB_DIR=/app/apps/web/dist
WORKDIR /app

COPY --from=build /deploy/node_modules apps/server/node_modules
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/web/dist apps/web/dist

# The data directory holds the SQLite database, the token secret and uploaded files.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM, on which it saves open documents and exits.
CMD ["node", "apps/server/dist/index.js"]
