# ─────────────────────────────────────────────────────────────
# Stage 1: Build Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS frontend

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/convex/package.json ./packages/convex/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/

# Build
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
RUN bun run --cwd apps/web build

# ─────────────────────────────────────────────────────────────
# Stage 2: Server + Serve Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/convex/package.json ./packages/convex/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy web source (includes server) and packages
COPY apps/web/ ./apps/web/
COPY packages/core/ ./packages/core/
COPY packages/convex/ ./packages/convex/

# Copy frontend build from stage 1
COPY --from=frontend /app/apps/web/dist ./apps/web/dist

EXPOSE 8787

CMD ["bun", "run", "--cwd", "apps/web", "start"]
