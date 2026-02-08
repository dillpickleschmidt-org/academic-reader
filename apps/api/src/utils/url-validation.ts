export function validateExternalUrl(urlString: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return "Invalid URL"
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http/https URLs allowed"
  }

  const hostname = parsed.hostname.toLowerCase()

  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    return "URL not allowed"
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      return "URL not allowed"
    }
  }

  if (
    hostname === "[::1]" ||
    /^\[?fc/i.test(hostname) ||
    /^\[?fd/i.test(hostname) ||
    /^\[?fe80:/i.test(hostname)
  ) {
    return "URL not allowed"
  }

  return null
}
