// atom.js — build an Atom 1.0 feed (RFC 4287) from plain data. Pure string work with no dependencies, so it is unit-tested on its own. Every value is XML-escaped and characters XML 1.0 forbids are dropped, so a hostile title cannot break the feed or inject markup.

/** Escape text for XML element content and attribute values. */
export const xmlEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  // characters XML 1.0 forbids (control codes other than tab, newline, carriage return) would make the whole feed unreadable
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

const iso = d => new Date(d).toISOString();

/**
 * One Atom document.
 * @param {object} f
 * @param {string} f.title feed title
 * @param {string} [f.subtitle] one-line description
 * @param {string} f.selfUrl absolute URL of this feed
 * @param {string} f.siteUrl absolute URL of the matching web page
 * @param {Date|string|number} [f.updated] newest change (defaults to the newest entry, else now)
 * @param {{id: string, title: string, url: string, published: Date|string, updated: Date|string, author?: string, summary?: string, html?: string, categories?: string[]}[]} f.entries
 * @returns {string} the XML text
 */
export function atomFeed({ title, subtitle = '', selfUrl, siteUrl, updated, entries = [], generator = 'web-primitives' }) {
  const newest = updated || entries.reduce((m, e) => (new Date(e.updated) > new Date(m) ? e.updated : m), entries[0]?.updated || Date.now());
  const items = entries.map(e => `<entry><id>${xmlEscape(e.id)}</id><title>${xmlEscape(e.title)}</title><link rel="alternate" type="text/html" href="${xmlEscape(e.url)}"/>`
    + `<published>${iso(e.published)}</published><updated>${iso(e.updated)}</updated>`
    + (e.author ? `<author><name>${xmlEscape(e.author)}</name></author>` : '')
    + (e.categories || []).map(c => `<category term="${xmlEscape(c)}"/>`).join('')
    + (e.summary ? `<summary type="text">${xmlEscape(e.summary)}</summary>` : '')
    + (e.html ? `<content type="html">${xmlEscape(e.html)}</content>` : '')
    + '</entry>').join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>${xmlEscape(selfUrl)}</id><title>${xmlEscape(title)}</title>`
    + (subtitle ? `<subtitle>${xmlEscape(subtitle)}</subtitle>` : '')
    + `<link rel="self" type="application/atom+xml" href="${xmlEscape(selfUrl)}"/><link rel="alternate" type="text/html" href="${xmlEscape(siteUrl)}"/>`
    + `<updated>${iso(newest)}</updated><generator>${xmlEscape(generator)}</generator>${items}</feed>\n`;
}
