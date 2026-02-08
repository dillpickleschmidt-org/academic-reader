import { generateText, Output } from "ai"
import { z } from "zod"
import { Effect } from "effect"
import { ModelProvider } from "../model-provider"

const BlockFilterElement = z.object({
  id: z.string(),
  include: z.boolean(),
})

const SYSTEM_PROMPT = `You are a document filter for a text-to-speech system. You will receive a list of HTML text blocks extracted from an academic document. Your job is to determine which blocks contain text that meaningfully contributes to the reading material versus blocks that are noise.

Mark a block as true (include) if it contains substantive content a reader would want to hear read aloud — body paragraphs, arguments, explanations, methodology, results, discussion, conclusions, abstracts, etc.

Mark a block as false (skip) if it is noise that does not contribute to understanding the document's content.

Blocks may have block-type "Text" or "TextInlineMath". Both types can contain substantive body text — TextInlineMath blocks simply contain inline math notation alongside prose. Evaluate them the same way: include if the surrounding text is substantive content, skip if it's noise. Do not let inline math, figure references, or citations cause you to skip an otherwise substantive paragraph.

When in doubt, include the block.

## Examples

Each block is presented as "[block_id]" on one line followed by its HTML.

### INCLUDE (true) — substantive body text:
[/page/1/Text/14]
<p block-type="Text">Traditionally, plant ecosystems are simulated by jointly generating plausible distributions of plant species and modeling their geometry <a href="#page-12-0">[Deussen et al.</a> <a href="#page-12-0">2002,</a> <a href="#page-12-1">1998;</a> <a href="#page-12-2">Lane and Prusinkiewicz 2002]</a>. Several approaches exists to capture the various levels of abstraction, such as volumetric textures <a href="#page-12-3">[Bruneton and Neyret 2012]</a>, voxels <a href="#page-12-4">[Jaeger and Teng 2003]</a>, or branch templates <a href="#page-13-1">[Livny et al.</a> <a href="#page-13-1">2011]</a>.</p>

### INCLUDE (true) — body text with inline math:
[/page/4/TextInlineMath/12]
<p block-type="TextInlineMath">We provide a set of module prototypes <math display="inline">S = \\{G_1, G_2, \\ldots, G_{|S|}\\}</math>. A module prototype can either be generated procedurally or manually designed by an artist (examples are shown in Fig. 4, a). We use <i>G </i>to create skeletal graphs of the module prototypes based on tree architectures discussed in Hallé et al. [1978]. A branch module is an instance of a specific module prototype <math display="inline">G_i \\in S</math> and describes the branching structure along with parameters associated with each node <i>n</i>, which are position, physiological age, branch length, and a thickening factor (<math display="inline">\\phi</math>). The parameters associated with each node <i>n</i> describe how to generate the surface mesh for each branch segment <i>e</i>.</p>

### SKIP (false) — DOI / pricing metadata:
[/page/1/Text/11]
<p block-type="Text">0730-0301/2019/7-ART131 $15.00 <a href="https://doi.org/10.1145/3306346.3323039">https://doi.org/10.1145/3306346.3323039</a></p>

### SKIP (false) — author addresses:
[/page/1/Text/9]
<p block-type="Text">Authors' addresses: Miłosz Makowski, Adam Mickiewicz University, Umultowska 87, 61-614 Poznań, Poland; Torsten Hädrich; Jan Scheffczyk; Dominik L. Michels, KAUST, Visual Computing Center, Thuwal 23955, KSA; Sören Pirk, Google Brain, 1600 Amphitheatre Parkway, Mountain View, CA, 94043; Wojtek Pałubicki, Adam Mickiewicz University, Umultowska 87, 61-614 Poznań, Poland.</p>

### SKIP (false) — copyright / permission notice:
[/page/1/Text/10]
<p block-type="Text">Permission to make digital or hard copies of all or part of this work for personal or classroom use is granted without fee provided that copies are not made or distributed for profit or commercial advantage and that copies bear this notice and the full citation on the first page. Copyrights for components of this work owned by others than ACM must be honored. Abstracting with credit is permitted. To copy otherwise, or republish, to post on servers or to redistribute to lists, requires prior specific permission and/or a fee. Request permissions from permissions@acm.org. © 2019 Association for Computing Machinery.</p>

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
  { "id": "/page/1/Text/14", "include": true },
  { "id": "/page/4/TextInlineMath/12", "include": true }
]`

export function filterBlocksForTTS(blocks: { id: string; html: string }[]) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const textBlocks = blocks.filter((b) => b.id.includes("Text"))

    if (textBlocks.length === 0) return {}

    const prompt = textBlocks
      .map((b) => `[${b.id}]\n${b.html}`)
      .join("\n\n---\n\n")

    const model = models.processingModel()

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model,
          output: Output.array({ element: BlockFilterElement }),
          system: SYSTEM_PROMPT,
          prompt,
        }),
      catch: (e) => e,
    }).pipe(Effect.either)

    if (result._tag === "Left" || !result.right.output) {
      console.warn("[tts-block-filter] AI classification failed")
      return Object.fromEntries(textBlocks.map((b) => [b.id, true]))
    }

    const map: Record<string, boolean> = {}
    for (const entry of result.right.output as { id: string; include: boolean }[]) {
      map[entry.id] = entry.include
    }
    return map
  })
}
