// html.js — HTML rendering with escape-by-default. Every interpolated value is HTML-escaped unless it
// was produced by html`` itself or explicitly wrapped in raw(). That rule is the core defence against
// cross-site scripting (XSS).

/** Wrapper marking a string as already-safe HTML, so html`` won't escape it again. */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
/** Mark `s` as trusted HTML. Use only for markup this code generated itself, never for user input. */
export const raw = s => new Raw(String(s));

// Replacement table for esc(). Templates double-quote every attribute, so escaping these five characters is enough.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape the five HTML-significant characters. Safe in text and in double-quoted attribute values. */
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

/** Convert one template value to safe HTML: null/false -> '', Raw -> as is, arrays -> joined, anything else -> escaped. */
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

/** Tagged template literal: html`<p>${value}</p>`. Every interpolated value is escaped unless it is raw() or came from another html``. This is the core XSS defence. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Lower-case ASCII slug for readable URLs (for example /articles/12/my-title). Cosmetic only: the numeric id identifies the item. */
export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_-]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'item';
}

/** Allow only absolute http(s) URLs; returns a normalised string or null. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch { return null; }
}

/** Relative same-site path only (blocks open redirects like //evil.com, /\evil.com, javascript:). */
export function safeBack(p, fallback = '/') {
  if (typeof p !== 'string' || p.length > 500) return fallback;
  if (!p.startsWith('/') || p.startsWith('//') || /[\\\x00-\x1f]/.test(p)) return fallback;
  return p;
}
