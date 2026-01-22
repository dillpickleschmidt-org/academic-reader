/**
 * Wrap text nodes in spans with data-word-index attributes.
 * Treats .katex elements as single blocks.
 */

export function wrapWordsInSpans(element: Element): void {
  let wordIndex = 0

  function processNode(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      // KaTeX element: treat as single word, don't recurse
      if (el.classList?.contains("katex")) {
        el.setAttribute("data-word-index", String(wordIndex++))
        el.classList.add("tts-word")
        return
      }
      // Regular element: recurse into children
      for (const child of Array.from(node.childNodes)) {
        processNode(child)
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ""
      if (!text.trim()) return

      const parts = text.split(/(\s+)/)
      const fragment = document.createDocumentFragment()
      for (const part of parts) {
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(part))
        } else if (part) {
          const span = document.createElement("span")
          span.setAttribute("data-word-index", String(wordIndex++))
          span.className = "tts-word"
          span.textContent = part
          fragment.appendChild(span)
        }
      }
      node.parentNode?.replaceChild(fragment, node)
    }
  }

  processNode(element)
}

export const originalHtmlMap = new WeakMap<HTMLElement, string>()

/**
 * Ensure words in element are wrapped with spans.
 * Checks if already wrapped, wraps if not.
 */
export function ensureWordsWrapped(element: Element): void {
  // Check if already wrapped (look for data-word-index attributes)
  if (element.querySelector("[data-word-index]")) {
    return
  }
  if (element instanceof HTMLElement) {
    originalHtmlMap.set(element, element.innerHTML)
  }
  wrapWordsInSpans(element)
}
