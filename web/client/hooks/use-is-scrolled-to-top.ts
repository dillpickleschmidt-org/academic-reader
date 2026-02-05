import { useState, useEffect } from "react"

export function useIsScrolledToTop(
  containerRef: React.RefObject<HTMLElement | null>,
  threshold = 10,
): boolean {
  const [atTop, setAtTop] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => setAtTop(container.scrollTop <= threshold)
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [containerRef, threshold])

  return atTop
}
