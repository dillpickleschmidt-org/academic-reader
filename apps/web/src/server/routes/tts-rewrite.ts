import { Hono } from "hono"
import { generateText } from "ai"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { createChatModel } from "../providers/models"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { chunkTextForTTS } from "../utils/tts-chunker"

const TTS_SYSTEM_PROMPT = `**Role & Output Rule**
You are an audio-preparation editor.
Your goal is to make the following be worded naturally for the read-aloud style of a TTS model, but with <10% being altered. Generally, you should return the text **word-for-word** except for the **four passes** below.
No summaries, no comments.

**Pass 1 – Remove Inline Citations**
\`[Author et al. 20XX]\` → \`\`

**Pass 2 – Read Aloud Math**
Convert LaTeX into plain English spoken equivalents. **Leave out no important variables and leave out no details that would change the meaning of the math**. Additionally, clarify the difference between uppercase and lowercase variables of the same letter if both are present in the same paragraph. To do this, use a "type descriptor" (such as "the set," "the graph," or "the matrix") and the word "capital" immediately before the variable name for uppercase versions. Use a type descriptor for the lowercase version as well.
Example 1: We provide a set of module prototypes $S=\{G_1, G_2, \dots, G_{|S|}\}$ -> We provide a set of module prototypes, S, which contains elements G sub-one, G sub-two, and so on, up to the total number of items in the set.
*note that no descriptors are added because there are no lowercase s or g variables present.
Example 2: Each edge $e\in E$ connects two nodes $n_1, n_2 \in N$ and represents an individual branch segment $e=(n_1, n_2)$ -> Each edge e, which is an element of the edge set capital E, connects two nodes n sub-one and n sub-two, which are elements of the node set capital N, and represents an individual branch segment e equals the pair n sub-one and n sub-two.
*note that "edge e" and "edge set capital E" are used to clearly contrast the specific items against the collections.

**Pass 3 – Sentence Slicing**
If a sentence exceeds ~40 words, break it at an existing comma or conjunction; keep original punctuation.

**Pass 4 – Micro-Glue (mandatory)**
You should perform **glue word changes** wherever the cadence feels stilted **when read aloud**; do **as many or as few** as needed—no quota, no ceiling.
Never change verbs, adjectives, or technical nouns.

After these four passes, output the text only.

An example sentence:
Before:
A branch module is defined as a connected acyclic graph $G=(N,E)$ , where $N$ and $E$ are sets of nodes and edges (referred to as branch segments).
After:
A branch module is defined as a connected acyclic graph, G equals the set containing N and E, where N and E are sets of nodes and edges, referred to as branch segments.
`

interface TTSRewriteRequest {
  documentId: string
  blockId: string
  chunkContent: string
  variation?: string
}

/** Segment data returned from Convex query */
interface SegmentData {
  index: number
  text: string
}

export const ttsRewrite = new Hono()

ttsRewrite.use("/tts/rewrite", requireAuth)

ttsRewrite.post("/tts/rewrite", async (c) => {
  const event = c.get("event")

  // Create authenticated Convex client
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSRewriteRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const {
    documentId,
    blockId,
    chunkContent,
    variation = "default",
  } = bodyResult.data

  if (!documentId || !blockId || !chunkContent) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId, chunkContent",
      code: "MISSING_FIELDS",
    }
    return c.json({ error: "Missing required fields" }, 400)
  }

  // Check if segments already exist
  const existingSegments = await tryCatch(
    convex.query(api.api.ttsSegments.getSegments, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
    }),
  )

  if (existingSegments.success && existingSegments.data.length > 0) {
    event.metadata = {
      cached: true,
      blockId,
      segmentCount: existingSegments.data.length,
    }
    return c.json({
      segments: existingSegments.data.map((s: SegmentData) => ({
        index: s.index,
        text: s.text,
      })),
      cached: true,
    })
  }

  // Generate reworded text
  let model
  try {
    model = createChatModel()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "MODEL_CONFIG_ERROR",
    }
    return c.json({ error: "Server configuration error" }, 500)
  }

  const generateStart = performance.now()

  const generateResult = await tryCatch(
    generateText({
      model,
      system: TTS_SYSTEM_PROMPT,
      prompt: chunkContent,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
    }),
  )

  if (!generateResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(generateResult.error),
      code: "AI_GENERATE_ERROR",
    }
    return c.json({ error: "Failed to generate TTS text" }, 500)
  }

  const rewordedText = generateResult.data.text
  const generateDurationMs = Math.round(performance.now() - generateStart)

  // Chunk the reworded text into segments (≤300 chars each)
  const chunks = chunkTextForTTS(rewordedText, 300)

  // Store segments in Convex
  const createResult = await tryCatch(
    convex.mutation(api.api.ttsSegments.createSegments, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
      texts: chunks.map((c) => c.text),
    }),
  )

  if (!createResult.success) {
    // Log but don't fail - caching is not critical
    console.error("Failed to store TTS segments:", createResult.error)
  }

  event.metadata = {
    cached: false,
    blockId,
    segmentCount: chunks.length,
    durationMs: generateDurationMs,
    inputTokens: generateResult.data.usage.inputTokens,
    outputTokens: generateResult.data.usage.outputTokens,
  }

  return c.json({
    segments: chunks,
    cached: false,
  })
})
