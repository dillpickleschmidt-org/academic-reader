import { generateText, Output } from "ai"
import { z } from "zod"
import { Effect } from "effect"
import { ModelProvider } from "../model-provider"
import { stripHtml } from "../../utils/sanitize"

const BATCH_SIZE = 15
const MAX_CONCURRENT_GROUPS = 3

const RewriteElement = z.object({
  id: z.string(),
  text: z.string(),
})

const SYSTEM_PROMPT = `**Role & Output Rule**
You are an audio-preparation editor. You will receive multiple text blocks, each prefixed with a line "ID: <blockId>". For each block, rewrite the text so it sounds natural when read aloud by a TTS model, but alter <10% of the content. Generally, return the text **word-for-word** except for the **four passes** below.

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

After these four passes, output a JSON array with one object per block. Each object must have "id" (the exact block ID from the input, e.g. "/page/1/Text/4") and "text" (the rewritten text). Return every block from the input.`

export interface RewriteResult {
  texts: Record<string, string>
  failedGroups: number
}

export function rewriteBlocksForTTS(blocks: { id: string; html: string }[]) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const textBlocks = blocks
      .map((b) => ({ id: b.id, text: stripHtml(b.html) }))
      .filter((b) => b.text.length > 0)

    if (textBlocks.length === 0) {
      return { texts: {}, failedGroups: 0 } satisfies RewriteResult
    }

    const model = models.processingModel()
    const groups: (typeof textBlocks)[] = []

    for (let i = 0; i < textBlocks.length; i += BATCH_SIZE) {
      groups.push(textBlocks.slice(i, i + BATCH_SIZE))
    }

    const texts: Record<string, string> = {}
    let failedGroups = 0

    for (let i = 0; i < groups.length; i += MAX_CONCURRENT_GROUPS) {
      const batch = groups.slice(i, i + MAX_CONCURRENT_GROUPS)
      const batchResults = yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            batch.map(async (group) => {
              const prompt = group
                .map((b) => `ID: ${b.id}\n${b.text}`)
                .join("\n\n---\n\n")

              try {
                const result = await generateText({
                  model,
                  output: Output.array({ element: RewriteElement }),
                  system: SYSTEM_PROMPT,
                  prompt,
                })

                if (result.output?.length) {
                  return { entries: result.output as { id: string; text: string }[], failed: false }
                }

                console.error("[tts-rewrite] LLM rewrite failed for group, falling back to plain text: no output")
                return {
                  entries: group.map((b) => ({ id: b.id, text: b.text })),
                  failed: true,
                }
              } catch (err) {
                console.error("[tts-rewrite] LLM rewrite failed for group, falling back to plain text:", err)
                return {
                  entries: group.map((b) => ({ id: b.id, text: b.text })),
                  failed: true,
                }
              }
            }),
          ),
        catch: () => [] as { entries: { id: string; text: string }[]; failed: boolean }[],
      })

      for (const { entries, failed } of batchResults) {
        if (failed) failedGroups++
        for (const entry of entries) {
          texts[entry.id] = entry.text
        }
      }
    }

    return { texts, failedGroups } satisfies RewriteResult
  })
}
