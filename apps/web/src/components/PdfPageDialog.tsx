import { useState, useEffect, useRef, useCallback } from "react"
import { Loader2, ZoomIn, ZoomOut } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@academic-reader/ui/primitives/dialog"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { useZoomPan } from "@/hooks/use-zoom-pan"
import { fetchPdfPage } from "@academic-reader/api-client/client"
import { AppRuntime } from "@/lib/runtime"
import type { PDFPageProxy, RenderTask } from "pdfjs-dist"

interface PdfPageDialogProps {
  pageNum: number | null
  displayPage: number | null
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const CLICK_ZOOM = 2

export function PdfPageDialog({
  pageNum,
  displayPage,
  documentId,
  open,
  onOpenChange,
}: PdfPageDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageRef = useRef<PDFPageProxy | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })

  const renderAtScale = useCallback(async (targetScale: number) => {
    const page = pageRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!page || !canvas || !container) return

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }

    const baseViewport = page.getViewport({ scale: 1 })
    const baseScaleFactor = container.clientWidth / baseViewport.width
    setBaseSize({ width: container.clientWidth, height: baseScaleFactor * baseViewport.height })

    const pixelScale = baseScaleFactor * targetScale * window.devicePixelRatio
    const scaledViewport = page.getViewport({ scale: pixelScale })

    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height

    const context = canvas.getContext("2d")
    if (!context) return

    const renderTask = page.render({
      canvasContext: context,
      viewport: scaledViewport,
      canvas,
    })
    renderTaskRef.current = renderTask

    try {
      await renderTask.promise
    } catch (err) {
      if (err instanceof Error && err.name !== "RenderingCancelledException") {
        throw err
      }
    } finally {
      if (renderTaskRef.current === renderTask) {
        renderTaskRef.current = null
      }
    }
  }, [])

  const { setContainerRef, containerRef, scale, position, isDragging, handlers, sliderProps, zoomTo, reset } = useZoomPan(
    baseSize,
    {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      clickZoom: CLICK_ZOOM,
      onZoomEnd: renderAtScale,
    }
  )

  useEffect(() => {
    if (!open) {
      reset()
      pageRef.current = null
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
      return
    }

    if (pageNum === null || !documentId) return

    let cancelled = false
    const loadPage = async () => {
      setLoading(true)
      setError(null)

      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString()

        const pdfData = await AppRuntime.runPromise(fetchPdfPage(documentId, pageNum))
        if (cancelled) return

        const pdf = await pdfjs.getDocument({ data: pdfData }).promise
        if (cancelled) return

        const page = await pdf.getPage(1)
        if (cancelled) return

        pageRef.current = page
        await renderAtScale(MIN_SCALE)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render page")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPage()
    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [open, pageNum, documentId, renderAtScale, reset])

  const ready = !loading && !error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Page {displayPage}</DialogTitle>
        </DialogHeader>

        <div
          ref={setContainerRef}
          {...handlers}
          className="relative min-h-[200px] -mt-2 -mx-3 -mb-3 overflow-hidden select-none"
          style={{ cursor: isDragging ? "grabbing" : scale > MIN_SCALE ? "grab" : "zoom-in" }}
        >
          {(loading || error) && (
            <div className="absolute inset-0 flex items-center justify-center">
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span>Loading page...</span>
                </div>
              ) : (
                <div className="text-destructive text-sm">{error}</div>
              )}
            </div>
          )}

          <div
            style={{ width: baseSize.width, height: baseSize.height }}
            className={ready ? "" : "invisible"}
          />
          <canvas
            ref={canvasRef}
            className={`absolute top-0 left-0 ${ready ? "" : "invisible"}`}
            style={{
              width: baseSize.width,
              height: baseSize.height,
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: "top left",
            }}
          />

          {ready && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-2 right-2 flex flex-col items-center gap-1 bg-background/60 backdrop-blur-xs rounded-full py-2.5 px-1.5 shadow-md cursor-default"
            >
              <ZoomIn className="size-4 text-muted-foreground cursor-pointer" onClick={() => zoomTo(scale + 0.5)} />
              <Slider
                orientation="vertical"
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={0.1}
                {...sliderProps}
                className="data-vertical:min-h-18 [&_[data-slot=slider-track]]:flex-1 [&_[data-slot=slider-track]]:opacity-50 cursor-grab active:cursor-grabbing"
                size="sm"
              />
              <ZoomOut className="size-4 text-muted-foreground cursor-pointer" onClick={() => zoomTo(scale - 0.5)} />
              <span className="text-[10px] text-muted-foreground font-mono mt-1">
                {Math.round(scale * 100)}%
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
