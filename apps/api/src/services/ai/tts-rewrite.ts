import {
  generateText,
  type FinishReason,
  type LanguageModel,
} from "ai"
import { Effect } from "effect"
import {
  ModelProvider,
  type ModelProviderOptions,
} from "../model-provider"

const BATCH_SIZE = 16
const MAX_CONCURRENT = 3
const REPAIR_ATTEMPTS = 3
const MAX_OUTPUT_TOKENS = 8_192
const OUTPUT_PREVIEW_CHARS = 4_000

type TtsRewriteAttempt = "initial" | "repair"
type RewriteBlock = { id: string; text: string }
type RewriteEntry = { id: string; text: string }

export interface TtsRewriteErrorDetails {
  ttsRewriteAttempt: TtsRewriteAttempt
  ttsRewriteRepairAttempt: number
  ttsRewriteBatchIndex: number
  ttsRewriteGroupSize: number
  ttsRewriteMissingCount: number
  ttsRewriteMissingIds: string[]
  ttsRewriteFinishReason: FinishReason
  ttsRewriteRawFinishReason?: string
  ttsRewriteInputTokens?: number
  ttsRewriteOutputTokens?: number
  ttsRewriteReasoningTokens?: number
  ttsRewriteTotalTokens?: number
  ttsRewriteMaxOutputTokens: number
  ttsRewritePromptChars: number
  ttsRewriteOutputChars: number
  ttsRewriteOutputPreview: string
  ttsRewriteParsedCount: number
  ttsRewriteParsedIds: string[]
}

export interface RewriteResult {
  texts: Record<string, string>
  repairedBlocks: number
}

class TtsRewriteOutputError extends Error {
  constructor(
    message: string,
    readonly details: TtsRewriteErrorDetails,
  ) {
    super(message)
    this.name = "TtsRewriteOutputError"
  }
}

export function getTtsRewriteErrorDetails(error: unknown) {
  return error instanceof TtsRewriteOutputError ? error.details : undefined
}

export function rewriteBlocksForTTS(blocks: { id: string; html: string }[]) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const textBlocks = blocks
      .map((b) => ({ id: b.id, text: b.html }))
      .filter((b) => b.text.length > 0)

    if (textBlocks.length === 0) {
      return { texts: {}, repairedBlocks: 0 } satisfies RewriteResult
    }

    const model = models.processingModel()
    const providerOptions = models.processingProviderOptions()
    const groups: (typeof textBlocks)[] = []

    for (let i = 0; i < textBlocks.length; i += BATCH_SIZE) {
      groups.push(textBlocks.slice(i, i + BATCH_SIZE))
    }

    const results = yield* Effect.forEach(
      groups.map((group, batchIndex) => ({ group, batchIndex })),
      ({ group, batchIndex }) =>
        Effect.tryPromise({
          try: () => rewriteBatch(group, batchIndex, model, providerOptions),
          catch: (e) => e as Error,
        }),
      { concurrency: MAX_CONCURRENT },
    )

    const texts: Record<string, string> = {}
    let repairedBlocks = 0
    for (const result of results) {
      repairedBlocks += result.repairedBlocks
      for (const entry of result.entries) {
        texts[entry.id] = entry.text
      }
    }

    return { texts, repairedBlocks } satisfies RewriteResult
  })
}

const SYSTEM_PROMPT = `**Role & Output Rule**
You are an audio-preparation editor. You will receive multiple HTML blocks, each prefixed with a line "ID: <blockId>". For each block, rewrite the text so it sounds natural when read aloud by a TTS model, but alter <10% of the content. Generally, return the text **word-for-word** except for the **four passes** below.

You must return exactly one output section for every input ID. Never skip, merge, rename, summarize, or omit an input ID, even if the block looks like metadata, a heading, a caption, or irrelevant text. Do not decide whether a block should be narrated; every input block was already selected for rewriting.

**Pass 1 – Remove Inline Citations**
\`[Author et al. 20XX]\` → \`\`

**Pass 2 – Read Aloud Math**
Convert LaTeX into plain English spoken equivalents. **Leave out no important variables and leave out no details that would change the meaning of the math**. Additionally, clarify the difference between uppercase and lowercase variables of the same letter if both are present in the same paragraph. To do this, use a "type descriptor" (such as "the set," "the graph," or "the matrix") and the word "capital" immediately before the variable name for uppercase versions. Use a type descriptor for the lowercase version as well.
Example 1: We provide a set of module prototypes $S=\\{G_1, G_2, \\dots, G_{|S|}\\}$ -> We provide a set of module prototypes, S, which contains elements G sub-one, G sub-two, and so on, up to the total number of items in the set.
*note that no descriptors are added because there are no lowercase s or g variables present.
Example 2: Each edge $e\\in E$ connects two nodes $n_1, n_2 \\in N$ and represents an individual branch segment $e=(n_1, n_2)$ -> Each edge e, which is in the edge set capital E, connects two nodes n sub-one and n sub-two, which are elements of the node set capital N, and represents an individual branch segment e equals the pair n sub-one and n sub-two.
*note that "edge e" and "edge set capital E" are used to clearly contrast the specific items against the collections.

**Pass 3 – Sentence Slicing**
If a sentence exceeds ~40 words, break it at an existing comma or conjunction; keep original punctuation.

**Pass 4 – Micro-Glue (mandatory)**
You should perform **glue word changes** wherever the cadence feels stilted **when read aloud**; do **as many or as few** as needed—no quota, no ceiling.
Never change verbs, adjectives, or technical nouns.

**Output format** – For every input block, output § followed by the exact input block ID, then the rewritten text on the following lines. The number of output sections must equal the number of input IDs.
§/page/1/Text/0
The rewritten text for the first block.
§/page/1/Text/1
The rewritten text for the second block.`

async function rewriteBatch(
  group: RewriteBlock[],
  batchIndex: number,
  model: LanguageModel,
  providerOptions: ModelProviderOptions,
): Promise<{ entries: RewriteEntry[]; repairedBlocks: number }> {
  const initial = await rewriteGroup(
    group,
    batchIndex,
    model,
    providerOptions,
    "initial",
  )

  if (!initial.missingIds.length) {
    return { entries: initial.entries, repairedBlocks: 0 }
  }

  const blockById = new Map(group.map((block) => [block.id, block]))
  const entries = [...initial.entries]

  for (const id of initial.missingIds) {
    const block = blockById.get(id)
    if (!block) {
      throw new Error(`TTS rewrite repair source block missing: ${id}`)
    }

    entries.push(
      ...(await repairBlock(block, batchIndex, model, providerOptions)),
    )
  }

  return { entries, repairedBlocks: initial.missingIds.length }
}

async function repairBlock(
  block: RewriteBlock,
  batchIndex: number,
  model: LanguageModel,
  providerOptions: ModelProviderOptions,
) {
  let lastResult: Awaited<ReturnType<typeof rewriteGroup>> | undefined

  for (let i = 1; i <= REPAIR_ATTEMPTS; i++) {
    const result = await rewriteGroup(
      [block],
      batchIndex,
      model,
      providerOptions,
      "repair",
      i,
    )

    if (!result.missingIds.length) return result.entries
    lastResult = result
  }

  if (lastResult) throw rewriteOutputError(lastResult)
  throw new Error(`TTS rewrite repair did not run: ${block.id}`)
}

async function rewriteGroup(
  group: RewriteBlock[],
  batchIndex: number,
  model: LanguageModel,
  providerOptions: ModelProviderOptions,
  attempt: TtsRewriteAttempt,
  repairAttempt = 0,
) {
  const groupIds = new Set(group.map((b) => b.id))
  const prompt = group
    .map((b) => `ID: ${b.id}\n${b.text}`)
    .join("\n\n---\n\n")
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
  })

  const entries = parseDelimitedOutput(result.text, groupIds)
  const rewrittenIds = new Set(entries.map((entry) => entry.id))
  const missingIds = group
    .map((block) => block.id)
    .filter((id) => !rewrittenIds.has(id))

  return {
    entries,
    missingIds,
    details: {
      ttsRewriteAttempt: attempt,
      ttsRewriteRepairAttempt: repairAttempt,
      ttsRewriteBatchIndex: batchIndex,
      ttsRewriteGroupSize: group.length,
      ttsRewriteMissingCount: missingIds.length,
      ttsRewriteMissingIds: missingIds.slice(0, 5),
      ttsRewriteFinishReason: result.finishReason,
      ttsRewriteRawFinishReason: result.rawFinishReason,
      ttsRewriteInputTokens: result.usage.inputTokens,
      ttsRewriteOutputTokens: result.usage.outputTokens,
      ttsRewriteReasoningTokens:
        result.usage.outputTokenDetails.reasoningTokens,
      ttsRewriteTotalTokens: result.usage.totalTokens,
      ttsRewriteMaxOutputTokens: MAX_OUTPUT_TOKENS,
      ttsRewritePromptChars: prompt.length,
      ttsRewriteOutputChars: result.text.length,
      ttsRewriteOutputPreview: result.text.slice(0, OUTPUT_PREVIEW_CHARS),
      ttsRewriteParsedCount: entries.length,
      ttsRewriteParsedIds: entries.map((entry) => entry.id).slice(0, 20),
    } satisfies TtsRewriteErrorDetails,
  }
}

function rewriteOutputError(result: Awaited<ReturnType<typeof rewriteGroup>>) {
  return new TtsRewriteOutputError(
    `TTS rewrite missing ${result.missingIds.length} block(s): ${result.missingIds.slice(0, 5).join(", ")}`,
    result.details,
  )
}

function parseDelimitedOutput(
  output: string,
  validIds: Set<string>,
): RewriteEntry[] {
  const entries: RewriteEntry[] = []
  const parts = output.split(/\n?§([^\n]+)\n/)

  for (let i = 1; i < parts.length - 1; i += 2) {
    const id = parts[i].trim()
    const text = parts[i + 1].trim()
    if (validIds.has(id) && text) entries.push({ id, text })
  }
  return entries
}
