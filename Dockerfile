# ─────────────────────────────────────────────────────────────
# Stage 1: Build Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS frontend

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json ./
COPY web/package.json ./web/
COPY mobile/package.json ./mobile/
COPY shared/core/package.json ./shared/core/
COPY shared/convex/package.json ./shared/convex/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY web/ ./web/
COPY shared/ ./shared/

# Build
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
RUN bun run --cwd web build

# ─────────────────────────────────────────────────────────────
# Stage 2: Server + Serve Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json ./
COPY web/package.json ./web/
COPY mobile/package.json ./mobile/
COPY shared/core/package.json ./shared/core/
COPY shared/convex/package.json ./shared/convex/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy web source (includes server) and packages
COPY web/ ./web/
COPY shared/core/ ./shared/core/
COPY shared/convex/ ./shared/convex/

# Copy frontend build from stage 1
COPY --from=frontend /app/web/dist ./web/dist

EXPOSE 8787

CMD ["bun", "run", "--cwd", "web", "start"]
