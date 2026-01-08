# ─────────────────────────────────────────────────────────────
# Stage 1: Build Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1 AS frontend

WORKDIR /frontend

# Install dependencies
COPY frontend/package.json frontend/bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# Copy source and build
COPY frontend/ ./
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
RUN bun run build

# ─────────────────────────────────────────────────────────────
# Stage 2: Build API + Serve Frontend
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1

WORKDIR /app

# Install API dependencies
COPY api/package.json api/bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# Copy API source
COPY api/src ./src

# Copy frontend build
COPY --from=frontend /frontend/dist ./frontend/dist

EXPOSE 8787

CMD ["bun", "run", "src/server.ts"]
