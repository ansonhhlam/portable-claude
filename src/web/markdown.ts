// Markdown rendering for the agent's replies.
//
// Raw HTML in the source is escaped by the marked renderer, and the output is
// sanitized with DOMPurify. Only http(s) and mailto links survive, and every
// link opens in a new tab without an opener or referrer. Images are dropped so
// a message cannot make the phone load remote content.
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_URL = /^(?:https?:|mailto:)/i;

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = href.trim();
      if (!SAFE_URL.test(url)) return label;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(url)}"${t} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

/**
 * Converts Markdown to HTML with raw HTML escaped, images reduced to their alt
 * text and unsafe links reduced to their label. The page still passes the
 * result through DOMPurify; this layer is pure so it can be unit tested.
 */
export function markdownToHtml(src: string): string {
  return marked.parse(src) as string;
}

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!SAFE_URL.test(href.trim())) {
        node.removeAttribute('href');
      } else {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
    'input',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'checked', 'disabled', 'start', 'align'],
  ALLOWED_URI_REGEXP: SAFE_URL,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_ATTR: ['style', 'id', 'name'],
};

/** Converts Markdown to sanitized HTML that is safe to assign to innerHTML. */
export function renderMarkdown(src: string): string {
  ensureHooks();
  const html = markdownToHtml(src);
  const clean = DOMPurify.sanitize(html, PURIFY_CONFIG);
  return typeof clean === 'string' ? clean : String(clean);
}

/** Renders Markdown into an element. */
export function setMarkdown(el: Element, src: string): void {
  el.innerHTML = renderMarkdown(src);
  // Task list checkboxes from GFM are display-only.
  for (const box of el.querySelectorAll('input')) {
    if (box.getAttribute('type') !== 'checkbox') box.remove();
    else box.setAttribute('disabled', '');
  }
}
