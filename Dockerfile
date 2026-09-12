# Multi-stage build for the Carpool Node services.
#
# Node 20 to match .nvmrc — the previous image was node:22-slim while the repo
# pinned 20, so the image and the developer machine were never the same runtime.
# Services run built JS from dist/, not tsx, so a type error cannot reach a
# container that started successfully.

FROM node:20-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY scripts/check-node.mjs scripts/
# ALL seven workspace manifests, not the five the services happen to run:
# pnpm-workspace.yaml globs packages/* and apps/*, and the lockfile has an
# importer for every one of them. `--frozen-lockfile` with an importer missing
# from disk fails outright (ERR_PNPM_OUTDATED_LOCKFILE) — it does not silently
# skip it. `apps/registry` now depends on `@carpool/tracker` (the vector index
# and ranking), so that one is load-bearing for the registry image rather than
# merely tidy.
COPY packages/hedera-x402/package.json packages/hedera-x402/
COPY packages/carpool-core/package.json packages/carpool-core/
COPY packages/carpool-tracker/package.json packages/carpool-tracker/
COPY apps/registry/package.json apps/registry/
COPY apps/bench/package.json apps/bench/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# No `|| true`: a failed build must fail the image, not ship a stale dist/.
RUN pnpm build

FROM node:20-slim AS runtime
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# The ledger database lives on a volume, never in the image.
VOLUME ["/data"]
EXPOSE 8403 3000
CMD ["node", "-e", "console.error('set a command in docker-compose.yml'); process.exit(1)"]
