FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY src ./src

# Expose port
EXPOSE 8787

# Run the self-hosted server
CMD ["bun", "run", "src/server.ts"]
