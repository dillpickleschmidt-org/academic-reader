# AGENTS.md

This file provides guidance to OpenCode when working with code in this repository.

## Overview

Academic Reader converts documents to HTML/Markdown. Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

**Stack:** Bun monorepo, React 19, Vite, Tailwind 4, Convex, Hono

## Commands

```bash
# Run the app
bun run dev  # scripts/dev.ts (don't run this unless instructed to)

# Build everything
docker compose --profile local build

# Type Check
bun run typecheck
```

Don't ever commit or push code to git unless I explicitly ask. If I allow you to commit, that does not necessarily mean I allow you to push.

### Backend Modes (set `BACKEND_MODE` in `.env.local`)

- `local` - Local GPU via Docker (requires NVIDIA Docker)
- `datalab` - Datalab API (no GPU required)
- `modal` - Modal cloud GPU with S3/MinIO storage

### Processing Modes

- `fast` - Uses Marker (layout-aware extraction)
- `balanced` - Uses LightOnOCR (vision model OCR)
- `aggressive` - Uses CHANDRA (vision model OCR, requires modal/datalab)

## Code Conventions

**Always use `bun`, never `npm` or `yarn`.**

**Formatting:** No semicolons, double quotes, 2-space indentation.

**Path alias:** `@/` maps to `web/client/`

### Monorepo Structure

- `web/client/` - React SPA
- `web/server/` - Hono API server
- `shared/convex/` - Convex functions + better-auth
- `shared/core/` - Shared UI components (shadcn/ui)
- `workers/` - GPU workers (marker, lightonocr, chandra, chatterbox-tts, qwen3-tts)

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

### No Thin Wrappers

While thin wrappers may be useful for readability in highly repeated invocations, they should generally be avoided when it would be simpler to inline. An example of what not to do:

```
function isMarkerBlock(block: WorkerChunkBlock): block is MarkerChunkBlock {
  return "id" in block && "block_type" in block
}
```

### Avoid comments explaining "changes"

While I'm fine with comments and documentation, I don't want any comments that explain code "changes" made as that's useless for new developers.

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
