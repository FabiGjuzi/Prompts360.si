// validate.js — input rules for account forms: usernames, passwords and numeric ids.

// Allowed usernames: 3-20 of letters, digits, underscore, hyphen.
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
// Names nobody may register (stops impersonation of staff and system accounts).
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'support', 'staff', 'official', 'mod',
  'moderator', 'deleted', 'removed', 'anon', 'anonymous', 'null', 'undefined', 'me', 'help', 'security']);

/** Return an error message if the username is invalid or reserved, else null. */
export function usernameProblem(u) {
  if (!USERNAME_RE.test(u)) return 'Usernames are 3–20 characters: letters, numbers, _ or -.';
  if (RESERVED.has(u.toLowerCase())) return 'That username is reserved.';
  return null;
}

/** Rules: 12–128 chars, at least one uppercase letter and one digit, both entries equal, no username inside. */
export function passwordProblem(pw, pw2, username = '') {
  if (pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/\p{Lu}/u.test(pw)) return 'Password needs at least one uppercase letter.';
  if (!/\d/.test(pw)) return 'Password needs at least one number.';
  if (pw !== pw2) return 'Passwords don’t match.';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return 'Password can’t contain your username.';
  return null;
}

/** Parse a positive integer id (1 to 15 digits) from a form string, or null. */
export const intId = v => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null);
