import { ReaderLayout } from "../components/ReaderLayout"

interface Props {
  content: string
  imagesReady: boolean
  onDownload: () => void
  onReset: () => void
}

export function HtmlResultPage({
  content,
  imagesReady,
  onDownload,
  onReset,
}: Props) {
  return (
    <ReaderLayout
      onDownload={onDownload}
      onReset={onReset}
      showThemeToggle
      downloadDisabled={!imagesReady}
    >
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </ReaderLayout>
  )
}
