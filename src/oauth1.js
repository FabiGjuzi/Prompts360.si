// oauth1.js — OAuth 1.0a request signing (RFC 5849, HMAC-SHA1): the "user context" signature that X's API accepts.
// Pure functions over node:crypto: no network, no dependencies, tested against the worked example in X's own documentation.
import crypto from 'node:crypto';

/** RFC 3986 percent-encoding. Stricter than encodeURIComponent, which leaves ! ' ( ) * unescaped. */
export const percent = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const byBytes = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

/**
 * The oauth_signature value. Signed: the method, the URL without its query string, and every query-string parameter, every form-body
 * parameter (`params`) and every oauth_* parameter, each percent-encoded and sorted. A JSON request body is not part of the signature.
 */
export function signature({ method, url, params = {}, oauth, consumerSecret, tokenSecret = '' }) {
  const u = new URL(url);
  const pairs = [...u.searchParams, ...Object.entries(params), ...Object.entries(oauth)].map(([k, v]) => [percent(k), percent(v)]).sort(byBytes);
  const base = [method.toUpperCase(), percent(`${u.protocol}//${u.host}${u.pathname}`), percent(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  return crypto.createHmac('sha1', `${percent(consumerSecret)}&${percent(tokenSecret)}`).update(base).digest('base64');
}

/** The value of the Authorization header for one request. `nonce` and `timestamp` are only passed in by tests. */
export function authorization({ method, url, params = {}, consumerKey, consumerSecret, token, tokenSecret, nonce = crypto.randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  const oauth = { oauth_consumer_key: consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_token: token, oauth_version: '1.0' };
  const oauth_signature = signature({ method, url, params, oauth, consumerSecret, tokenSecret });
  return `OAuth ${Object.entries({ ...oauth, oauth_signature }).sort(byBytes).map(([k, v]) => `${percent(k)}="${percent(v)}"`).join(', ')}`;
}
