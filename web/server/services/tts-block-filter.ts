import { generateText, Output } from "ai"
import { z } from "zod"
import { createProcessingModel } from "../providers/models"
import { tryCatch } from "../utils/try-catch"

const BlockFilterElement = z.object({
  id: z.string(),
  include: z.boolean(),
})

const SYSTEM_PROMPT = `You are a document filter for a text-to-speech system. You will receive a list of HTML text blocks extracted from an academic document. Your job is to determine which blocks contain text that meaningfully contributes to the reading material versus blocks that are noise.

Mark a block as true (include) if it contains substantive content a reader would want to hear read aloud — body paragraphs, arguments, explanations, methodology, results, discussion, conclusions, abstracts, etc.

Mark a block as false (skip) if it is noise that does not contribute to understanding the document's content.

## Examples

### INCLUDE (true) — substantive body text:
<p block-type="Text" data-block-id="/page/1/Text/14">
   Traditionally, plant ecosystems are simulated by jointly generating plausible distributions of plant species and modeling their geometry
   <a href="#page-12-0">
    [Deussen et al.
   </a>
   <a href="#page-12-0">
    2002,
   </a>
   <a href="#page-12-1">
    1998;
   </a>
   <a href="#page-12-2">
    Lane and Prusinkiewicz 2002]
   </a>
   . Several approaches exists to capture the various levels of abstraction, such as volumetric textures
   <a href="#page-12-3">
    [Bruneton and Neyret 2012]
   </a>
   , voxels
   <a href="#page-12-4">
    [Jaeger and Teng 2003]
   </a>
   , or branch templates
   <a href="#page-13-1">
    [Livny et al.
   </a>
   <a href="#page-13-1">
    2011]
   </a>
   . Choosing the appropriate level of detail scheme is critical for modeling plant ecosystems, and a few approaches have been proposed to enable simplifications, while also adhering to plant structure
   <a href="#page-12-5">
    [Gum
   </a>
   <a href="#page-12-5">
    bau et al.
   </a>
   <a href="#page-12-5">
    2011;
   </a>
   <a href="#page-13-2">
    [Neubert et al.
   </a>
   <a href="#page-13-2">
    2011]
   </a>
   . Only more recently methods focus on realistic geometric representations for trees with an emphasize on individual parts
   <a href="#page-13-3">
    [Xie et al.
   </a>
   <a href="#page-13-3">
    2016;
   </a>
   <a href="#page-13-4">
    Zhang et al.
   </a>
   <a href="#page-13-4">
    2017]
   </a>
   , and
  </p>

### SKIP (false) — DOI / pricing metadata:
<p block-type="Text" data-block-id="/page/1/Text/11">
   0730-0301/2019/7-ART131 $15.00
   <a href="https://doi.org/10.1145/3306346.3323039">
    https://doi.org/10.1145/3306346.3323039
   </a>
  </p>

### SKIP (false) — author addresses:
<p block-type="Text" data-block-id="/page/1/Text/9">
   Authors' addresses: Miłosz Makowski, Adam Mickiewicz University, Umultowska 87, 61-614 Poznań, Poland; Torsten Hädrich; Jan Scheffczyk; Dominik L. Michels, KAUST, Visual Computing Center, Thuwal 23955, KSA; Sören Pirk, Google Brain, 1600 Amphitheatre Parkway, Mountain View, CA, 94043; Wojtek Pałubicki, Adam Mickiewicz University, Umultowska 87, 61-614 Poznań, Poland.
  </p>

### SKIP (false) — copyright / permission notice:
<p block-type="Text" data-block-id="/page/1/Text/10">
   Permission to make digital or hard copies of all or part of this work for personal or classroom use is granted without fee provided that copies are not made or distributed for profit or commercial advantage and that copies bear this notice and the full citation on the first page. Copyrights for components of this work owned by others than ACM must be honored. Abstracting with credit is permitted. To copy otherwise, or republish, to post on servers or to redistribute to lists, requires prior specific permission and/or a fee. Request permissions from permissions@acm.org. © 2019 Association for Computing Machinery.
  </p>

## Additional patterns to SKIP:
- Journal/conference metadata (volume, issue, article numbers, ISSN)
- "Received / Accepted / Published" date lines
- Page numbers, running headers/footers
- Reference list entries (individual bibliography items)
- Funding acknowledgment boilerplate
- Figure/table captions that are just labels with no explanatory text

## Output format

Return every block id from the input with its include decision. Example:

[
  { "id": "/page/1/Text/9", "include": false },
  { "id": "/page/1/Text/10", "include": false },
  { "id": "/page/1/Text/11", "include": false },
  { "id": "/page/1/Text/14", "include": true }
]`

/**
 * Classify which Text blocks are worth reading aloud for TTS.
 * Sends all blocks to the LLM at once so it can use surrounding context.
 * Returns a map of blockId -> true (include) / false (skip).
 */
export async function filterBlocksForTTS(
  blocks: { id: string; html: string }[],
): Promise<Record<string, boolean>> {
  const textBlocks = blocks.filter((b) => b.id.includes("Text"))

  if (textBlocks.length === 0) {
    return {}
  }

  const prompt = textBlocks
    .map((b) => `[${b.id}]\n${b.html}`)
    .join("\n\n---\n\n")

  const model = createProcessingModel()

  const result = await tryCatch(
    generateText({
      model,
      output: Output.array({ element: BlockFilterElement }),
      system: SYSTEM_PROMPT,
      prompt,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
    }),
  )

  if (!result.success) {
    console.warn("[tts-block-filter] AI classification failed:", result.error)
    return Object.fromEntries(textBlocks.map((b) => [b.id, true]))
  }

  if (!result.data.output) {
    console.warn("[tts-block-filter] AI returned no output")
    return Object.fromEntries(textBlocks.map((b) => [b.id, true]))
  }

  const map: Record<string, boolean> = {}
  for (const entry of result.data.output) {
    map[entry.id] = entry.include
  }
  return map
}
