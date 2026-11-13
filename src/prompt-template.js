// prompt-template.js — pure helpers for sharing text prompts: find the prompt inside a Markdown post, list its fill-in variables
// ({{NAME}} and [placeholder]), fill them in, and build "open in a chat site" links. No I/O and no dependencies.

/** Longest prompt (in characters, after URL-encoding) that an "Open in …" link may carry. Chat sites cut long ?q= values (about 2 KB is the safe size). */
export const OPEN_LINK_MAX = 1800;
/** Most fill-in fields one post gets, and the longest value of one field. */
export const MAX_VARIABLES = 12, MAX_VALUE = 400;

const FENCE = /^[ \t]*```[^\n]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/m;

/**
 * The text a reader copies: the first fenced code block if the post has one, otherwise the whole post text.
 * (A post that explains a prompt and then shows it in a code block copies only the prompt; a post that is the prompt copies all of it.)
 * @param {string} body Markdown body of the post
 * @returns {string} the prompt, trimmed ('' for an empty body)
 */
export function extractPrompt(body) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const m = text.match(FENCE);
  // Code blocks are verbatim. Everything else loses Markdown's backslash escapes (the editor writes \[ and \_ for literal brackets and underscores), so the copy reads as the page does.
  return (m ? m[1] : text.replace(/\\([\\`*_~\[\]()#>+\-.!])/g, '$1')).trim();
}

// {{NAME}} (letters, digits, space, _ and -) or [placeholder] (1–40 characters, not a Markdown link or checkbox, not a bare number).
const BRACES = /\{\{\s*([A-Za-z][A-Za-z0-9 _-]{0,39}?)\s*\}\}/g;
const BRACKETS = /\[([^\[\]\n(){}]{2,40})\](?!\()/g;

/** True for bracket text that is really a placeholder: not a number, not an ellipsis, not an unchecked/checked box. */
const isPlaceholder = s => /[\p{L}]/u.test(s) && !/^\s*[xX ]\s*$/.test(s) && !/^[.…\s]+$/.test(s);

/**
 * The fill-in variables of a prompt, in order of first appearance, without repeats.
 * @param {string} prompt
 * @returns {{token: string, label: string}[]} `token` is the exact text to replace (e.g. "[topic]" or "{{TOPIC}}"), `label` the text shown to the reader
 */
export function extractVariables(prompt) {
  const found = new Map();
  const text = String(prompt || '');
  for (const m of text.matchAll(BRACES)) if (!found.has(m[0])) found.set(m[0], { token: m[0], label: m[1].trim(), at: m.index });
  for (const m of text.matchAll(BRACKETS)) if (isPlaceholder(m[1]) && !found.has(m[0])) found.set(m[0], { token: m[0], label: m[1].trim(), at: m.index });
  return [...found.values()].sort((a, b) => a.at - b.at).slice(0, MAX_VARIABLES).map(({ token, label }) => ({ token, label }));
}

/**
 * Replace each variable's token with the reader's value; variables left empty stay as they are.
 * @param {string} prompt
 * @param {Record<string, string>} values token → value
 */
export function fill(prompt, values = {}) {
  let out = String(prompt || '');
  for (const [token, value] of Object.entries(values)) {
    const v = String(value ?? '').slice(0, MAX_VALUE);
    if (v) out = out.split(token).join(v);
  }
  return out;
}

/**
 * "Open in …" links that start a chat with the prompt typed in. Returns {} when the prompt is too long for a link.
 * @param {string} prompt
 * @returns {{chatgpt?: string, claude?: string}}
 */
export function openLinks(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return {};
  const q = encodeURIComponent(text);
  if (q.length > OPEN_LINK_MAX) return {};
  return { chatgpt: `https://chatgpt.com/?q=${q}`, claude: `https://claude.ai/new?q=${q}` };
}
