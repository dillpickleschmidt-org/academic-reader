import { SUN_ICON, BOOK_ICON, MOON_ICON } from "../constants/icons"
import katexCss from "katex/dist/katex.min.css?raw"
import baseResultCss from "../styles/base-result.css?raw"
import htmlResultCss from "../styles/html-result.css?raw"

export type OutputFormat = "html" | "markdown" | "json"

export const getDownloadExtension = (format: OutputFormat): string =>
  format === "html" ? "html" : format === "json" ? "json" : "md"

export const getDownloadMimeType = (format: OutputFormat): string =>
  format === "html"
    ? "text/html"
    : format === "json"
      ? "application/json"
      : "text/markdown"

export const downloadBlob = (
  content: string,
  filename: string,
  mimeType: string,
) => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const generateHtmlDocument = (
  renderedContent: string,
  title: string,
): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${katexCss}
${baseResultCss}
${htmlResultCss}
  </style>
</head>
<body>
  <!-- Theme radio inputs - must be siblings before .reader-output for CSS selectors -->
  <input type="radio" name="theme" id="theme-light" class="theme-radios" checked>
  <input type="radio" name="theme" id="theme-comfort" class="theme-radios">
  <input type="radio" name="theme" id="theme-dark" class="theme-radios">
  <script>
    // Eagerly apply saved theme before render
    (function() {
      var theme = localStorage.getItem('reader-theme');
      if (theme && theme !== 'light') {
        document.getElementById('theme-light').checked = false;
        document.getElementById('theme-' + theme).checked = true;
      }
    })();
  </script>

  <div class="reader-output">
    <div class="reader-theme-toggle">
      <label for="theme-light" title="Light">${SUN_ICON}</label>
      <label for="theme-comfort" title="Comfort">${BOOK_ICON}</label>
      <label for="theme-dark" title="Dark">${MOON_ICON}</label>
    </div>
    <div class="reader-content">
${renderedContent}
    </div>
  </div>

  <script>
    // Persist theme changes to localStorage
    document.querySelectorAll('input[name="theme"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        localStorage.setItem('reader-theme', this.id.replace('theme-', ''));
      });
    });
  </script>
</body>
</html>`
}

export const downloadResult = (
  content: string,
  fileName: string,
  outputFormat: OutputFormat,
) => {
  const ext = getDownloadExtension(outputFormat)
  const mimeType = getDownloadMimeType(outputFormat)
  const baseName = fileName.replace(/\.[^/.]+$/, "")

  let downloadContent = content

  if (outputFormat === "html") {
    const renderedContent =
      document.querySelector(".reader-content")?.innerHTML || content
    downloadContent = generateHtmlDocument(renderedContent, baseName)
  }

  downloadBlob(downloadContent, `${baseName}.${ext}`, mimeType)
}
