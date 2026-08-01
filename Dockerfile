# Multi-stage: the client toolchain (vite, tailwind) is build-time only and has
# no business in the runtime image.

# ---- build ------------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

# Copy manifests first so `npm ci` is cached and only re-runs when deps change,
# not on every source edit.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY . .
RUN npm run build --workspace client

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# argon2 ships prebuilt binaries, but keep the toolchain available in case the
# platform's architecture needs a source build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# --omit=dev drops vite, tailwind, mongodb-memory-server and friends. The last
# one matters: it would otherwise try to download a MongoDB binary at runtime.
RUN npm ci --omit=dev --workspace server --include-workspace-root \
  && npm cache clean --force

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# Never run as root.
RUN useradd --system --uid 10001 halo \
  && mkdir -p /app/server/uploads \
  && chown -R halo:halo /app
USER halo

EXPOSE 4000

# The platform's own health check can hit this; it verifies the process is
# actually serving, not merely running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
