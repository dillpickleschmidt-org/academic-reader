import { useEffect, useRef } from "react"

export function useScrollDirection(
  containerRef: React.RefObject<HTMLElement | null>
) {
  const lastScrollY = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => {
      const currentY = container.scrollTop
      const direction = currentY < lastScrollY.current ? "up" : "down"
      container.dataset.scrollDirection = direction
      lastScrollY.current = currentY
    }

    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [containerRef])
}
