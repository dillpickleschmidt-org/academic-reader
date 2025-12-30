import { ReaderLayout } from "../components/ReaderLayout"

interface Props {
  content: string
  onDownload: () => void
  onReset: () => void
}

export function JsonResultPage({ content, onDownload, onReset }: Props) {
  const formatted = (() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  })()

  return (
    <ReaderLayout onDownload={onDownload} onReset={onReset}>
      <pre>{formatted}</pre>
    </ReaderLayout>
  )
}
