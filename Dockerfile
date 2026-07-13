# ---- builder: install deps (compiles better-sqlite3) + build the Mini App ----
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install with the lockfile first for better layer caching.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/webapp/package.json packages/webapp/
RUN npm ci

COPY . .
RUN npm run build:webapp

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WEBAPP_DIST=/app/packages/webapp/dist \
    DATABASE_URL=/data/banana-split.sqlite \
    PORT=3000

# Copy installed deps (incl. the compiled better-sqlite3 native binary) + source
# + the built Mini App. node_modules is arch-matched because it's built on the
# same base image (build on your homelab host so it matches your CPU).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/packages ./packages

# Run from the server workspace so Node's ESM resolver finds `tsx` (and its
# esbuild dep), which npm nested under packages/server/node_modules rather than
# hoisting to the root. cwd-relative paths are avoided elsewhere (env.ts and the
# migrations resolve via import.meta.url; WEBAPP_DIST is absolute above).
WORKDIR /app/packages/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
