/**
 * HTML post-processing for reader enhancements.
 */
import * as cheerio from 'cheerio';
import katex from 'katex';

/**
 * Apply reader enhancements to HTML: citations, math, figure captions, etc.
 */
export function enhanceHtmlForReader(html: string): string {
  const $ = cheerio.load(html);

  // 1. Remove redundant img-description elements (alt is already on img)
  $('.img-description').remove();

  // 2. Citation detection & wrapping
  wrapCitations($);

  // 3. Single-pass paragraph processing (author meta, figures, continuations)
  processParagraphs($);

  // 4. Convert <math> LaTeX to HTML via KaTeX (universal browser support)
  convertMathToHtml($);

  return $('body').html() || '';
}

/**
 * Citation patterns:
 * - Author-year: [Smith 2020], [Smith et al. 2020], [Smith and Jones 2020; Brown 2021]
 * - Numeric: [1], [1, 2], [1-5], [1, 3-5, 8]
 */
const CITATION_PATTERN = /\[(?:[A-Z][^\]]*\d{4}|[\d,;\s\-–]+)\]/g;

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
 * Single-pass paragraph processing: author meta, figure captions, continuations.
 */
function processParagraphs($: cheerio.CheerioAPI): void {
  const h1 = $('h1').first();
  const authorSectionEnd = h1.length > 0 ? h1.nextAll('h1, h2').first() : null;

  $('p').each(function () {
    const $p = $(this);
    const text = $p.text().replace(/\s+/g, ' ').trim();

    // Author meta: short paragraphs between h1 and first h2
    if (h1.length > 0 && text.length < 200) {
      const isAfterH1 = $p.prevAll().filter('h1').first().is(h1);
      const isBeforeH2 = !authorSectionEnd?.length || $p.nextAll().filter('h1, h2').first().is(authorSectionEnd);
      if (isAfterH1 && isBeforeH2) {
        $p.addClass('author-meta');
      }
    }

    // Figure caption: starts with "Fig. #"
    if (/^Fig\.\s*\d/.test(text)) {
      $p.addClass('figure-caption');
    }
    // Continuation: starts with lowercase
    else if (text.length > 0 && /^[a-z]/.test(text)) {
      $p.addClass('continuation');
    }
  });
}

/**
 * Convert <math> tags containing LaTeX to HTML via KaTeX.
 * KaTeX outputs HTML+CSS that works on all browsers (no MathML dependency).
 */
function convertMathToHtml($: cheerio.CheerioAPI): void {
  $('math').each(function () {
    const latex = $(this).text().trim();
    if (!latex) return;

    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
        output: 'htmlAndMathml',
      });
      $(this).replaceWith(html);
    } catch (e) {
      console.warn(`[html] KaTeX failed for: ${latex.slice(0, 50)}...`, e);
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
