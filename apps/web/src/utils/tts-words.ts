export function splitWords(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return trimmed.split(/\s+/)
}
