# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the app
bun run dev  # scripts/dev.ts (don't run this unless instructed to)

# Type Check
bun run typecheck
```

### Backend Modes (set `BACKEND_MODE` in `.env.dev`)

- `local` - Local GPU via Docker (requires NVIDIA Docker)
- `runpod` - Runpod cloud GPU with S3/MinIO storage
- `datalab` - Datalab API (no GPU required)

## Code Conventions

### File Organization

- Public API at top of file
- Private helpers below, in order of usage

```ts
export function mainFunction() {
  helperA()
  helperB()
}

function helperA() { ... }
function helperB() { ... }
```

### Data Loading States

- `undefined` = not yet loaded → show skeleton/loader
- `[]` = loaded but empty → show empty state

Avoid fallbacks like `?? []` that mask the difference. Derive loading state from the data itself or derived reactive data, not separate `isLoading` props.

```tsx
<Show when={data !== undefined} fallback={<Loader />}>
  <Show when={data.length} fallback={<EmptyState />}>
    <Content data={data} />
  </Show>
</Show>
```

### Convex Folder Structure

- `api/` - Thin queries/mutations: define args, pass ctx to model helpers, return
- `model/` - Business logic + auth checks via `ctx.auth.getUserIdentity()` (when necessary)
