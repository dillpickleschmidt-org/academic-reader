FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Serve with a simple static server
FROM oven/bun:1

WORKDIR /app

RUN bun add serve

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["bunx", "serve", "dist", "-l", "3000"]
