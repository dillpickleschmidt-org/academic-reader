export interface ChunkBlock {
  id: string
  block_type: string
  html: string
  bbox: number[]
  polygon: number[]
  section_hierarchy?: Record<string, string>
  includeTts?: boolean
  ttsText?: string
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
    }
  }
  return {
    id: `chandra-${index}`,
    block_type: block.label,
    html: block.content,
    bbox: block.bbox,
    polygon: [],
  }
}

export function normalizeChunks(blocks: WorkerChunkBlock[]): ChunkBlock[] {
  return blocks.map((block, index) => normalizeChunk(block, index))
}

export interface ChunkInput {
  blockId: string
  blockType: string
  html: string
  section?: string
  bbox: number[]
  includeTts?: boolean
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
        : undefined,
      bbox: chunk.bbox,
      includeTts: chunk.includeTts,
    }))
}
