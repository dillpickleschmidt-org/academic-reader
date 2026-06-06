export interface ChunkBlock {
  id: string
  block_type: string
  html: string
  bbox: number[]
  polygon: number[]
  section_hierarchy?: Record<string, string>
  includeTts?: boolean | null
  ttsText?: string | null
  order: number
}

interface MarkerChunkBlock {
  id: string
  block_type: string
  html: string
  bbox: number[]
  section_hierarchy?: Record<string, string>
}

interface ChandraChunkBlock {
  label: string
  content: string
  bbox: number[]
}

type WorkerChunkBlock = MarkerChunkBlock | ChandraChunkBlock

export function normalizeChunk(
  block: WorkerChunkBlock,
  index: number,
): ChunkBlock {
  if ("id" in block) {
    return {
      id: block.id,
      block_type: block.block_type,
      html: block.html,
      bbox: block.bbox,
      polygon: [],
      section_hierarchy: block.section_hierarchy,
      order: index,
    }
  }
  return {
    id: `chandra-${index}`,
    block_type: block.label,
    html: block.content,
    bbox: block.bbox,
    polygon: [],
    order: index,
  }
}

export interface ChunkInput {
  blockId: string
  blockType: string
  html: string
  section: string | null
  bbox: number[]
  includeTts: boolean | null
  order: number
}

export function transformChunks(chunks: ChunkBlock[]): ChunkInput[] {
  return chunks
    .filter((chunk) => chunk.html.trim().length > 0)
    .map((chunk) => ({
      blockId: chunk.id,
      blockType: chunk.block_type,
      html: chunk.html,
      section: chunk.section_hierarchy
        ? Object.values(chunk.section_hierarchy).filter(Boolean).join(" > ")
        : null,
      bbox: chunk.bbox,
      includeTts: chunk.includeTts ?? null,
      order: chunk.order,
    }))
}
