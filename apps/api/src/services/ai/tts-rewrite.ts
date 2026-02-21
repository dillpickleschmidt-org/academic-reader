import { generateText } from "ai"
import { Effect } from "effect"
import { ModelProvider } from "../model-provider"

const BATCH_SIZE = 15
const MAX_CONCURRENT = 3

const SYSTEM_PROMPT = `**Role & Output Rule**
You are an audio-preparation editor. You will receive multiple HTML blocks, each prefixed with a line "ID: <blockId>". For each block, rewrite the text so it sounds natural when read aloud by a TTS model, but alter <10% of the content. Generally, return the text **word-for-word** except for the **four passes** below.

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

**Output format** – For each block, output § followed by the exact block ID, then the rewritten text on the following lines.
§/page/1/Text/0
The rewritten text for the first block.
§/page/1/Text/1
The rewritten text for the second block.`

export interface RewriteResult {
  texts: Record<string, string>
  failedGroups: number
  fallbackBlockCount: number
}

function parseDelimitedOutput(
  output: string,
  validIds: Set<string>,
): { entries: { id: string; text: string }[]; fallbackBlockCount: number } {
  const entries: { id: string; text: string }[] = []
  const parts = output.split(/\n?§(\/page\/[^\n]+)\n/)
  let fallbackBlockCount = 0

  for (let i = 1; i < parts.length - 1; i += 2) {
    const id = parts[i].trim()
    const text = parts[i + 1].trim()
    if (!validIds.has(id) || !text) {
      fallbackBlockCount++
      continue
    }
    entries.push({ id, text })
  }
  return { entries, fallbackBlockCount }
}

export function rewriteBlocksForTTS(blocks: { id: string; html: string }[]) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const textBlocks = blocks
      .map((b) => ({ id: b.id, text: b.html }))
      .filter((b) => b.text.length > 0)

    if (textBlocks.length === 0) {
      return { texts: {}, failedGroups: 0, fallbackBlockCount: 0 } satisfies RewriteResult
    }

    const model = models.processingModel()
    const groups: (typeof textBlocks)[] = []

    for (let i = 0; i < textBlocks.length; i += BATCH_SIZE) {
      groups.push(textBlocks.slice(i, i + BATCH_SIZE))
    }

    const results = yield* Effect.forEach(
      groups,
      (group) => {
        const groupIds = new Set(group.map((b) => b.id))
        return Effect.tryPromise({
          try: () =>
            generateText({
              model,
              system: SYSTEM_PROMPT,
              prompt: group
                .map((b) => `ID: ${b.id}\n${b.text}`)
                .join("\n\n---\n\n"),
            }),
          catch: (e) => e as Error,
        }).pipe(
          Effect.map((result) => {
            const parsed = parseDelimitedOutput(result.text, groupIds)
            if (parsed.entries.length > 0) {
              return { ...parsed, failed: false }
            }
            return {
              entries: group.map((b) => ({ id: b.id, text: b.text })),
              fallbackBlockCount: group.length,
              failed: true,
            }
          }),
          Effect.catchAll(() =>
            Effect.succeed({
              entries: group.map((b) => ({ id: b.id, text: b.text })),
              fallbackBlockCount: group.length,
              failed: true,
            }),
          ),
        )
      },
      { concurrency: MAX_CONCURRENT },
    )

    const texts: Record<string, string> = {}
    let failedGroups = 0
    let fallbackBlockCount = 0
    for (const result of results) {
      if (result.failed) failedGroups++
      fallbackBlockCount += result.fallbackBlockCount
      for (const entry of result.entries) {
        texts[entry.id] = entry.text
      }
    }

    return { texts, failedGroups, fallbackBlockCount } satisfies RewriteResult
  })
}
