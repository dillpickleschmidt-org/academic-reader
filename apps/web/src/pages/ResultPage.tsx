import "../styles/base-result.css"
import type { OutputFormat } from "../hooks/use-conversion"
import { HtmlResultPage } from "./HtmlResultPage"
import { MarkdownResultPage } from "./MarkdownResultPage"
import { JsonResultPage } from "./JsonResultPage"

interface Props {
  outputFormat: OutputFormat
  content: string
  imagesReady: boolean
  documentId: string | null
  markdown: string
  onDownload: () => void
  onReset: () => void
}

export function ResultPage({
  outputFormat,
  content,
  imagesReady,
  documentId,
  markdown,
  onDownload,
  onReset,
}: Props) {
  switch (outputFormat) {
    case "html":
      return (
        <HtmlResultPage
          content={content}
          imagesReady={imagesReady}
          documentId={documentId}
          markdown={markdown}
          onDownload={onDownload}
          onReset={onReset}
        />
      )
    case "markdown":
      return (
        <MarkdownResultPage
          content={content}
          onDownload={onDownload}
          onReset={onReset}
        />
      )
    case "json":
      return (
        <JsonResultPage
          content={content}
          onDownload={onDownload}
          onReset={onReset}
        />
      )
    default: {
      const _exhaustive: never = outputFormat
      throw new Error(`Unhandled output format: ${_exhaustive}`)
    }
  }
}
