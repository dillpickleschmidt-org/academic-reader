#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

const CSS = `
* {
  box-sizing: border-box;
}

/* Theme variables */
:root {
  --bg: #fff;
  --text: #333;
  --text-heading: #1a1a1a;
  --text-muted: #666;
  --border: #eee;
  --border-strong: #e0e0e0;
  --link: #0066cc;
  --code-bg: #f5f5f5;
  --citation-bg: #f8f9fa;
  --citation-text: #555;
}

[data-theme="comfort"] {
  --bg: #f5f1e8;
  --text: #3d3632;
  --text-heading: #2a2520;
  --text-muted: #6b5f54;
  --border: #e0d9cc;
  --border-strong: #d4cbbf;
  --link: #1a5f8a;
  --code-bg: #ebe6db;
  --citation-bg: #ebe6db;
  --citation-text: #5a4f44;
}

[data-theme="dark"] {
  --bg: #1a1a1a;
  --text: #d4d4d4;
  --text-heading: #e8e8e8;
  --text-muted: #999;
  --border: #333;
  --border-strong: #444;
  --link: #6db3f2;
  --code-bg: #2d2d2d;
  --citation-bg: #2d2d2d;
  --citation-text: #aaa;
}

html {
  font-size: 20px;
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
  max-width: 850px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  transition: background 0.3s, color 0.3s;
}

/* Theme toggle */
.theme-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.25rem;
  background: var(--code-bg);
  padding: 0.25rem;
  border-radius: 6px;
  z-index: 1000;
}

.theme-toggle button {
  background: transparent;
  border: none;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.8rem;
  color: var(--text-muted);
  transition: background 0.2s, color 0.2s;
}

.theme-toggle button:hover {
  background: var(--border);
}

.theme-toggle button.active {
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-heading);
}

h1 {
  font-size: 1.6rem;
  margin-top: 2rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}

/* Major section headings - more breathing room */
h2 {
  font-size: 1.2rem;
  margin-top: 3.5rem;
  margin-bottom: 1.5rem;
  padding-top: 2rem;
  border-top: 1px solid var(--border-strong);
}

/* First h2 doesn't need top border */
h1 + h2, body > h2:first-child {
  border-top: none;
  padding-top: 0;
  margin-top: 2rem;
}

h3 {
  font-size: 1.05rem;
  margin-top: 2.5rem;
  margin-bottom: 1rem;
}

h4 {
  font-size: 0.95rem;
  margin-top: 2rem;
  margin-bottom: 0.75rem;
}

/* Paragraphs with first-line indent */
p {
  margin: 1rem 0;
  text-indent: 1.5em;
}

/* No indent for first paragraph after heading or after non-paragraph elements */
h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p,
img + p, .img-description + p, figure + p, blockquote + p,
ul + p, ol + p, table + p, pre + p {
  text-indent: 0;
}

a {
  color: var(--link);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1.5rem auto;
  border-radius: 4px;
}

/* Hide AI-generated image descriptions */
.img-description {
  display: none;
}

/* Figure caption styling (paragraphs starting with "Fig.") */
.figure-caption {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  text-indent: 0;
  margin: 0.5rem 0 1.5rem;
}

/* Continuation paragraphs (mid-sentence splits) */
.continuation {
  text-indent: 0;
}

/* Citation styling */
.citation {
  background: var(--citation-bg);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-size: 0.92em;
  color: var(--citation-text);
  white-space: nowrap;
}

/* Author/metadata section styling */
.author-meta {
  font-size: 0.9rem;
  margin: 0.5rem 0;
  text-indent: 0 !important;
}

code {
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

pre {
  background: var(--code-bg);
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
}

pre code {
  background: none;
  padding: 0;
}

blockquote {
  border-left: 4px solid var(--border-strong);
  margin: 1rem 0;
  padding-left: 1rem;
  color: var(--text-muted);
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1.5rem 0;
}

th, td {
  border: 1px solid var(--border-strong);
  padding: 0.75rem;
  text-align: left;
}

th {
  background: var(--code-bg);
  font-weight: 600;
}

hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2rem 0;
}

ul, ol {
  padding-left: 1.5rem;
  margin: 1rem 0;
}

li {
  margin: 0.5rem 0;
}
`;

// JavaScript to style citations [Author et al. Year] patterns
const CITATION_SCRIPT = `
<script>
document.addEventListener('DOMContentLoaded', function() {
  // Match patterns like [Author et al. Year], [Author Year], [Author and Author Year]
  // Also handles multiple citations like [Author 2020; Author 2021]
  const citationPattern = /\\[([A-Z][a-zA-Zà-ÿ]+(?:\\s+(?:et\\s+al\\.|and\\s+[A-Z][a-zA-Zà-ÿ]+))?(?:\\s+\\d{4})?(?:;\\s*[A-Z][a-zA-Zà-ÿ]+(?:\\s+(?:et\\s+al\\.|and\\s+[A-Z][a-zA-Zà-ÿ]+))?(?:\\s+\\d{4})?)*)\\]/g;

  function processTextNode(node) {
    const text = node.textContent;
    if (!citationPattern.test(text)) return;

    citationPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = citationPattern.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      // Add the citation span
      const span = document.createElement('span');
      span.className = 'citation';
      span.textContent = match[0];
      fragment.appendChild(span);
      lastIndex = citationPattern.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(fragment, node);
  }

  // Walk through all text nodes in paragraphs
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.parentNode.tagName !== 'SCRIPT' &&
        walker.currentNode.parentNode.tagName !== 'STYLE') {
      textNodes.push(walker.currentNode);
    }
  }

  textNodes.forEach(processTextNode);

  // Mark author/metadata paragraphs (short paragraphs between first h1 and first h2)
  const h1 = document.querySelector('h1');
  if (h1) {
    // Remove all elements before the first h1 (logos, metadata junk)
    while (h1.previousElementSibling && !h1.previousElementSibling.classList.contains('theme-toggle')) {
      h1.previousElementSibling.remove();
    }

    let el = h1.nextElementSibling;
    while (el && el.tagName !== 'H1' && el.tagName !== 'H2') {
      if (el.tagName === 'P' && el.textContent.length < 200) {
        el.classList.add('author-meta');
      }
      el = el.nextElementSibling;
    }
  }

  // Mark figure captions (paragraphs starting with "Fig.")
  // Mark continuation paragraphs (starting with lowercase = mid-sentence continuation)
  document.querySelectorAll('p').forEach(p => {
    const text = p.textContent.replace(/\\s+/g, ' ').trim();
    if (/^Fig\\.\\s*\\d/.test(text)) {
      p.classList.add('figure-caption');
    } else if (/^[a-z]/.test(text)) {
      p.classList.add('continuation');
    }
  });

  // Render LaTeX in <math> tags using KaTeX
  function renderMath() {
    document.querySelectorAll('math').forEach(el => {
      const latex = el.textContent.trim();
      try {
        const rendered = katex.renderToString(latex, { throwOnError: false });
        const span = document.createElement('span');
        span.innerHTML = rendered;
        el.replaceWith(span);
      } catch (e) {
        console.warn('KaTeX error:', e);
      }
    });
  }

  if (typeof katex !== 'undefined') {
    renderMath();
  } else {
    // Wait for KaTeX to load
    const checkKatex = setInterval(() => {
      if (typeof katex !== 'undefined') {
        clearInterval(checkKatex);
        renderMath();
      }
    }, 50);
  }
});
</script>
`;

function styleHtml(inputPath: string): void {
  const content = readFileSync(inputPath, "utf-8");

  const THEME_TOGGLE = `
<div class="theme-toggle">
  <button data-theme="light" class="active">Light</button>
  <button data-theme="comfort">Comfort</button>
  <button data-theme="dark">Dark</button>
</div>
`;

  const THEME_SCRIPT = `
<script>
(function() {
  const saved = localStorage.getItem('reader-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  document.querySelectorAll('.theme-toggle button').forEach(btn => {
    if (btn.dataset.theme === (saved || 'light')) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      if (theme === 'light') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      localStorage.setItem('reader-theme', theme);
      document.querySelectorAll('.theme-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
})();
</script>
`;

  const styledHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <style>${CSS}</style>
</head>
<body>
${THEME_TOGGLE}
${content}
${CITATION_SCRIPT}
${THEME_SCRIPT}
</body>
</html>`;

  const dir = dirname(inputPath);
  const base = basename(inputPath, ".html");
  const outputPath = join(dir, `${base}-styled.html`);

  writeFileSync(outputPath, styledHtml);
  console.log(`Styled output written to: ${outputPath}`);
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: bun run style-marker-html.ts <input.html>");
  process.exit(1);
}

for (const inputPath of args) {
  styleHtml(inputPath);
}
