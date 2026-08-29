# syntax=docker/dockerfile:1

# ---------- build: compile native deps (better-sqlite3) ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/brandcast.db \
    UPLOAD_DIR=/app/uploads

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# writable volumes owned by the unprivileged node user
RUN mkdir -p /data /app/uploads && chown -R node:node /data /app/uploads
USER node

EXPOSE 4000
VOLUME ["/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/server.js"]
