import { useMemo, useEffect, useRef, useCallback, useState } from "react"
import "../styles/base-result.css"
import "../styles/html-result.css"
import "katex/dist/katex.min.css"
import "katex/dist/contrib/copy-tex"
import { ReaderLayout } from "../components/ReaderLayout"
import { useDocumentContext } from "@/context/DocumentContext"
import { useTTSChunkDetection } from "@/hooks/use-tts-chunk-detection"
import { useWordHighlighting } from "@/hooks/use-word-highlighting"
import { useAudioActions, useAudioSelector } from "@/context/AudioContext"
import { PdfPageDialog } from "@/components/PdfPageDialog"

interface Props {
  content: string
  imagesReady: boolean
  onDownload: () => void
  onReset: () => void
}

export function ResultPage({
  content,
  imagesReady,
  onDownload,
  onReset,
}: Props) {
  const documentContext = useDocumentContext()
  const documentId = documentContext?.documentId ?? null
  const audioReadiness = documentContext?.audioReadiness
  const currentVoice = useAudioSelector((s) => s.narrator.voice)
  const { loadBlockTTS } = useAudioActions()
  const pageOffset = documentContext?.toc?.offset ?? 0
  const eligibleBlockIds = useMemo(() => {
    if (!audioReadiness?.ttsReady) return undefined
    return new Set(audioReadiness.eligibleBlockIds)
  }, [audioReadiness])
  const { handleContentClick } = useTTSChunkDetection(
    eligibleBlockIds,
    (blockId, wordIndex) => {
      loadBlockTTS(blockId, wordIndex !== null ? { wordIndex } : undefined)
    },
  )

  useWordHighlighting()

  const [pdfPageDialogOpen, setPdfPageDialogOpen] = useState(false)
  const [pdfPageNum, setPdfPageNum] = useState<number | null>(null)
  const [pdfDisplayPage, setPdfDisplayPage] = useState<number | null>(null)

  const htmlContent = useMemo(() => ({ __html: content }), [content])
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contentRef.current) return
    const markers = contentRef.current.querySelectorAll(".page-marker")
    markers.forEach((marker) => {
      const match = marker.id.match(/^page-marker-(\d+)$/)
      if (match) {
        const physicalPage = parseInt(match[1], 10)
        marker.textContent = String(physicalPage - pageOffset + 1)
      }
    })
  }, [pageOffset])

  useEffect(() => {
    if (!contentRef.current) return

    if (!audioReadiness?.ttsReady) {
      contentRef.current.querySelectorAll("[data-tts-ready]").forEach((el) => {
        el.removeAttribute("data-tts-ready")
      })
      return
    }

    const readyBlocks = new Set(
      audioReadiness.voices[currentVoice].audioBlockIds,
    )
    const eligibleBlocks = new Set(audioReadiness.eligibleBlockIds)
    contentRef.current.querySelectorAll("[data-block-id]").forEach((el) => {
      const blockId = el.getAttribute("data-block-id")
      if (!blockId || !eligibleBlocks.has(blockId)) {
        el.removeAttribute("data-tts-ready")
        return
      }
      el.setAttribute(
        "data-tts-ready",
        readyBlocks.has(blockId) ? "true" : "false",
      )
    })
  }, [audioReadiness, currentVoice, content])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement

      const pageMarker = target.closest(".page-marker") as HTMLElement | null
      if (pageMarker && documentId) {
        const match = pageMarker.id.match(/^page-marker-(\d+)$/)
        if (match) {
          const physicalPage = parseInt(match[1], 10)
          setPdfPageNum(physicalPage)
          setPdfDisplayPage(physicalPage - pageOffset + 1)
          setPdfPageDialogOpen(true)
          return
        }
      }

      const anchor = target.closest("a[href^='#']") as HTMLAnchorElement | null
      if (anchor) {
        e.preventDefault()
        const targetId = anchor.getAttribute("href")!.slice(1)
        const targetEl =
          document.getElementById(targetId) ??
          document.querySelector(`[data-block-id="${targetId}"]`)
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth" })
        }
        return
      }

      handleContentClick(e)
    },
    [handleContentClick, documentId, pageOffset],
  )

  useEffect(() => {
    if (!contentRef.current) return

    const updateShadows = (el: Element) => {
      const container = el.parentElement
      if (!container) return
      const hasOverflow = el.scrollWidth > el.clientWidth
      container.classList.toggle(
        "has-overflow-left",
        hasOverflow && el.scrollLeft > 0,
      )
      container.classList.toggle(
        "has-overflow-right",
        hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      )
    }

    contentRef.current.querySelectorAll(".table-scroll").forEach((el) => {
      if (el.scrollWidth > el.clientWidth) {
        const table = el.querySelector("table")
        if (table) table.classList.add("table-compact")
      }

      updateShadows(el)
      el.addEventListener("scroll", () => updateShadows(el), { passive: true })
    })
  }, [content])

  return (
    <ReaderLayout
      onDownload={onDownload}
      onReset={onReset}
      showThemeToggle
      showSidebar
      downloadDisabled={!imagesReady}
    >
      {/* Safe: content is generated by Marker from user's own uploaded document */}
      <div
        ref={contentRef}
        onClick={handleClick}
        dangerouslySetInnerHTML={htmlContent}
      />
      <PdfPageDialog
        pageNum={pdfPageNum}
        displayPage={pdfDisplayPage}
        documentId={documentId}
        open={pdfPageDialogOpen}
        onOpenChange={setPdfPageDialogOpen}
      />
    </ReaderLayout>
  )
}
