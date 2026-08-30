# syntax=docker/dockerfile:1
#
# All-Bun image. There is no Node stage and no compiler step: Bun runs the
# TypeScript data plane directly, and every dependency is pure JavaScript, so no
# native addon has to be built for the runtime architecture.

# ---------- deps: full workspace install for the build ----------
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY web/package.json ./web/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---------- api-deps: production-only tree for the API/WS data plane ----------
# Next's standalone output traces its own dependencies, so the runtime image needs
# only the server's runtime packages. Dropping `workspaces` excludes Next entirely.
FROM oven/bun:1.4-alpine AS api-deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun -e "const p=require('./package.json'); delete p.workspaces; require('fs').writeFileSync('package.json', JSON.stringify(p))" \
    && bun install --production

# ---------- build: compile the Next.js app to a standalone bundle ----------
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY web ./web
COPY src ./src
COPY server.ts tsconfig.json ./
RUN cd web && bun run build

# The standalone server embeds its resolved config as a literal. Extract it so the
# custom entrypoint can pass it to getRequestHandlers() without calling loadConfig(),
# which would need the webpack bundle that tracing strips out.
RUN bun -e "\
const fs=require('fs');\
const src=fs.readFileSync('web/.next/standalone/web/server.js','utf8');\
const m=src.match(/const nextConfig = (\{.*\})\n/);\
if(!m){console.error('could not extract nextConfig');process.exit(1);}\
fs.writeFileSync('web/.next/standalone/web/standalone-config.json', m[1]);\
console.log('extracted standalone config');"

# ---------- runtime ----------
FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads \
    NEXT_TELEMETRY_DISABLED=1

# DATABASE_URL has no default on purpose: the service must be pointed at a Postgres
# it is meant to use, not silently start against the wrong one.

# ffmpeg powers the HLS ladder and image variants; curl backs the healthcheck.
RUN apk add --no-cache ffmpeg curl

# Order matters. The standalone bundle ships a *traced* node_modules holding just
# the packages Next needs at runtime. Copy it first, then layer the API's
# production dependencies on top: the two trees are disjoint, so they merge.
COPY --from=build    /app/web/.next/standalone/ ./
COPY --from=api-deps /app/node_modules          ./node_modules
COPY --from=build    /app/web/.next/static      ./web/.next/static
COPY --from=build    /app/web/public            ./web/public

COPY package.json tsconfig.json server.ts ./
COPY src ./src
COPY scripts ./scripts
# The generated migrations are applied at boot, so they ship with the image.
COPY drizzle ./drizzle

RUN mkdir -p /data/uploads && chown -R bun:bun /data
USER bun

EXPOSE 4000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["bun", "server.ts"]
