import { useState, useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/core/ui/primitives/dialog"

interface PdfPageDialogProps {
  pageNum: number | null
  displayPage: number | null
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PdfPageDialog({
  pageNum,
  displayPage,
  documentId,
  open,
  onOpenChange,
}: PdfPageDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !pageNum || !documentId) return

    let cancelled = false
    const renderPage = async () => {
      setLoading(true)
      setError(null)

      try {
        // Lazy load PDF.js
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString()

        // Fetch single-page PDF from server
        const response = await fetch(
          `/api/saved-documents/${documentId}/page/${pageNum}`,
          { credentials: "include" },
        )

        if (!response.ok) {
          throw new Error("Failed to load page")
        }

        const pdfData = await response.arrayBuffer()
        if (cancelled) return

        // Load and render the PDF page
        const pdf = await pdfjs.getDocument({ data: pdfData }).promise
        if (cancelled) return

        const page = await pdf.getPage(1)
        if (cancelled) return

        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        // Scale to fit container width while maintaining aspect ratio
        const viewport = page.getViewport({ scale: 1 })
        const containerWidth = container.clientWidth
        const scale = (containerWidth / viewport.width) * window.devicePixelRatio
        const scaledViewport = page.getViewport({ scale })

        canvas.width = scaledViewport.width
        canvas.height = scaledViewport.height
        canvas.style.width = `${containerWidth}px`
        canvas.style.height = `${(containerWidth / viewport.width) * viewport.height}px`

        const context = canvas.getContext("2d")
        if (!context) return

        await page.render({
          canvasContext: context,
          viewport: scaledViewport,
          canvas,
        }).promise
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render page")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    renderPage()
    return () => {
      cancelled = true
    }
  }, [open, pageNum, documentId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Page {displayPage}</DialogTitle>
        </DialogHeader>

        <div ref={containerRef} className="flex items-center justify-center min-h-[200px] -mt-2 -mx-3 -mb-3">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading page...</span>
            </div>
          )}

          {error && (
            <div className="text-destructive text-sm">{error}</div>
          )}

          <canvas
            ref={canvasRef}
            className={loading || error ? "hidden" : ""}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
