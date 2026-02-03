import { useState, useRef, useCallback, useEffect } from "react"

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

interface UseZoomPanOptions {
  minScale?: number
  maxScale?: number
  clickZoom?: number
  onZoomEnd?: (scale: number) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function zoomToPoint(oldScale: number, newScale: number, px: number, py: number, oldPos: Position): Position {
  const f = newScale / oldScale
  return { x: px - (px - oldPos.x) * f, y: py - (py - oldPos.y) * f }
}

function clampPosition(pos: Position, scale: number, container: Size, content: Size): Position {
  const sw = content.width * scale
  const sh = content.height * scale
  return {
    x: sw <= container.width ? (container.width - sw) / 2 : clamp(pos.x, container.width - sw, 0),
    y: sh <= container.height ? (container.height - sh) / 2 : clamp(pos.y, container.height - sh, 0),
  }
}

export function useZoomPan(
  contentSize: Size,
  options: UseZoomPanOptions = {},
) {
  const { minScale = 1, maxScale = 4, clickZoom = 2, onZoomEnd } = options

  const [scale, setScale] = useState(minScale)
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const latest = useRef({ scale, position, contentSize, onZoomEnd, minScale, maxScale, clickZoom })
  latest.current = { scale, position, contentSize, onZoomEnd, minScale, maxScale, clickZoom }
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const dragStartRef = useRef<Position | null>(null)
  const didDragRef = useRef(false)
  const pinchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setContainer(node)
  }, [])

  const getContainerSize = (): Size => {
    const el = containerRef.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 }
  }

  const apply = useCallback((newScale: number, newPos: Position) => {
    const { contentSize: c, minScale: min, maxScale: max } = latest.current
    const s = clamp(newScale, min, max)
    const p = clampPosition(newPos, s, getContainerSize(), c)
    setScale(s)
    setPosition(p)
    latest.current.scale = s
    latest.current.position = p
    return s
  }, [])

  const reset = useCallback(() => {
    apply(latest.current.minScale, { x: 0, y: 0 })
  }, [apply])

  useEffect(() => {
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      const { scale: s, position: p, contentSize: c, onZoomEnd: end } = latest.current
      if (c.width === 0) return
      e.preventDefault()

      if (e.ctrlKey) {
        const rect = container.getBoundingClientRect()
        const newScale = s * (1 - e.deltaY * 0.01)
        const final = apply(newScale, zoomToPoint(s, newScale, e.clientX - rect.left, e.clientY - rect.top, p))

        if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current)
        pinchTimeoutRef.current = setTimeout(() => end?.(final), 150)
      } else {
        apply(s, { x: p.x - e.deltaX, y: p.y - e.deltaY })
      }
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [container, apply])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragStartRef.current = { x: e.clientX - latest.current.position.x, y: e.clientY - latest.current.position.y }
    didDragRef.current = false
    setIsDragging(true)

    const onMouseMove = (e: MouseEvent) => {
      didDragRef.current = true
      apply(latest.current.scale, { x: e.clientX - dragStartRef.current!.x, y: e.clientY - dragStartRef.current!.y })
    }
    const onMouseUp = () => {
      dragStartRef.current = null
      setIsDragging(false)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [apply])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) return
    const el = containerRef.current
    const { scale: s, position: p, contentSize: c, minScale: min, clickZoom: cz, onZoomEnd: end } = latest.current
    if (!el || c.width === 0) return

    const rect = el.getBoundingClientRect()
    const pointX = e.clientX - rect.left
    const pointY = e.clientY - rect.top
    const contentX = (pointX - p.x) / s
    const newScale = s === min ? cz : min
    const pivotY = zoomToPoint(s, newScale, pointX, pointY, p).y
    const final = apply(newScale, { x: el.clientWidth / 2 - contentX * newScale, y: pivotY })
    end?.(final)
  }, [apply])

  const zoomTo = useCallback((newScale: number) => {
    const { scale: s, position: p } = latest.current
    const cs = getContainerSize()
    const final = apply(newScale, zoomToPoint(s, newScale, cs.width / 2, cs.height / 2, p))
    latest.current.onZoomEnd?.(final)
  }, [apply])

  const handleSliderChange = useCallback((value: number | readonly number[]) => {
    const newScale = Array.isArray(value) ? value[0] : value
    const { scale: s, position: p } = latest.current
    const cs = getContainerSize()
    apply(newScale, zoomToPoint(s, newScale, cs.width / 2, cs.height / 2, p))
  }, [apply])

  const handleSliderCommit = useCallback(() => {
    latest.current.onZoomEnd?.(latest.current.scale)
  }, [])

  return {
    setContainerRef,
    containerRef,
    scale,
    position,
    isDragging,
    handlers: {
      onMouseDown: handleMouseDown,
      onClick: handleClick,
    },
    sliderProps: {
      value: [scale] as [number],
      onValueChange: handleSliderChange,
      onValueCommitted: handleSliderCommit,
    },
    zoomTo,
    reset,
  }
}
