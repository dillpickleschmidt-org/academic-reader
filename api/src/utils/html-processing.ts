/**
 * HTML post-processing for reader enhancements.
 */
import * as cheerio from 'cheerio';
import temml from 'temml';

/**
 * Apply reader enhancements to HTML: citations, math, figure captions, etc.
 */
export function enhanceHtmlForReader(html: string): string {
  const $ = cheerio.load(html);

  // 1. Citation detection & wrapping
  wrapCitations($);

  // 2. Mark author metadata paragraphs
  markAuthorMeta($);

  // 3. Mark figure captions and continuations
  markFiguresAndContinuations($);

  // 4. Convert <math> LaTeX to MathML with data-latex fallback
  convertMathToMathML($);

  return $('body').html() || '';
}

/**
 * Citation pattern: [Author et al. Year], [Author Year], [Author and Author Year]
 */
const CITATION_PATTERN =
  /\[([A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?(?:\s+\d{4})?(?:;\s*[A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?(?:\s+\d{4})?)*)\]/g;

/**
 * Wrap academic citations in spans for styling.
 */
function wrapCitations($: cheerio.CheerioAPI): void {
  // Process all text nodes
  $('body')
    .find('*')
    .contents()
    .filter(function () {
      return this.type === 'text';
    })
    .each(function () {
      const text = $(this).text();
      if (!CITATION_PATTERN.test(text)) return;

      // Reset regex state
      CITATION_PATTERN.lastIndex = 0;

      const parts: string[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = CITATION_PATTERN.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(escapeHtml(text.slice(lastIndex, match.index)));
        }
        // Add wrapped citation
        parts.push(`<span class="citation">${escapeHtml(match[0])}</span>`);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)));
      }

      if (parts.length > 0) {
        $(this).replaceWith(parts.join(''));
      }
    });
}


/**
 * Mark author/metadata paragraphs (short paragraphs between h1 and first h2).
 */
function markAuthorMeta($: cheerio.CheerioAPI): void {
  const h1 = $('h1').first();
  if (h1.length === 0) return;

  let el = h1.next();
  while (el.length > 0 && !el.is('h1, h2')) {
    if (el.is('p')) {
      const text = el.text().trim();
      if (text.length < 200) {
        el.addClass('author-meta');
      }
    }
    el = el.next();
  }
}

/**
 * Mark figure captions and continuation paragraphs.
 */
function markFiguresAndContinuations($: cheerio.CheerioAPI): void {
  $('p').each(function () {
    const text = $(this).text().replace(/\s+/g, ' ').trim();

    // Figure caption: starts with "Fig. #"
    if (/^Fig\.\s*\d/.test(text)) {
      $(this).addClass('figure-caption');
    }
    // Continuation: starts with lowercase (likely continuation of previous paragraph)
    else if (text.length > 0 && text[0] === text[0].toLowerCase() && /^[a-z]/.test(text)) {
      $(this).addClass('continuation');
    }
  });
}

/**
 * Convert <math> tags containing LaTeX to MathML with data-latex fallback for KaTeX.
 */
function convertMathToMathML($: cheerio.CheerioAPI): void {
  $('math').each(function () {
    const latex = $(this).text().trim();
    if (!latex) return;

    try {
      const mathml = temml.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
      });

      // Wrap in container with data-latex for KaTeX progressive enhancement
      const wrapper = $('<span>')
        .addClass('math-render')
        .attr('data-latex', latex)
        .html(mathml);

      $(this).replaceWith(wrapper);
    } catch (e) {
      // Log failure but leave original
      console.warn(`[html] LaTeX conversion failed for: ${latex.slice(0, 50)}...`, e);
    }
  });
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
