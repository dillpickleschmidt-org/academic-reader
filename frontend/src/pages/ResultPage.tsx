import type { OutputFormat } from "../hooks/useConversion"
import { HtmlResultPage } from "./HtmlResultPage"
import { MarkdownResultPage } from "./MarkdownResultPage"
import { JsonResultPage } from "./JsonResultPage"

interface Props {
  fileName: string
  outputFormat: OutputFormat
  content: string
  imagesReady: boolean
  onDownload: () => void
  onReset: () => void
}

export function ResultPage({
  outputFormat,
  content,
  imagesReady,
  onDownload,
  onReset,
}: Props) {
  switch (outputFormat) {
    case "html":
      return (
        <HtmlResultPage
          content={content}
          imagesReady={imagesReady}
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
  }
}
