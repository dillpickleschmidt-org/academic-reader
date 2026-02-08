# ─────────────────────────────────────────────────────────────
# Stage 1: Build Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS frontend

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/convex/package.json ./packages/convex/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY apps/web/ ./apps/web/
COPY packages/ ./packages/

# Build
ARG VITE_CONVEX_URL
ARG BACKEND_MODE
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV BACKEND_MODE=$BACKEND_MODE
RUN bun run --cwd apps/web build

# ─────────────────────────────────────────────────────────────
# Stage 2: API Server
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1

WORKDIR /app

# Copy workspace config and package files
COPY package.json bun.lock* tsconfig.base.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/convex/package.json ./packages/convex/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy API source + packages
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/

# Copy frontend build from stage 1
COPY --from=frontend /app/apps/web/dist ./apps/web/dist

EXPOSE 8787

CMD ["bun", "run", "--cwd", "apps/api", "src/main.ts"]
