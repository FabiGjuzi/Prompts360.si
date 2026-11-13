// session-secure.test.js — cookie headers when the cookie must be Secure (production, or COOKIE_SECURE=1).
// A separate file because the setting is read once at import time.
process.env.VALKEY_URL = 'memory';
process.env.COOKIE_SECURE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';

const s = await import('../src/session.js');

test('the cookie gets the __Host- prefix and the Secure attribute', () => {
  assert.equal(s.cookieHeader('tok'), '__Host-sid=tok; Path=/; HttpOnly; SameSite=Lax; Secure');
});

test('the clearing cookie keeps the same name and attributes', () => {
  assert.equal(s.clearCookieHeader(), '__Host-sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
});

test('readCookie looks for the prefixed name', () => {
  assert.equal(s.readCookie({ headers: { cookie: '__Host-sid=abc; sid=decoy' } }), 'abc');
  assert.equal(s.readCookie({ headers: { cookie: 'sid=decoy' } }), null);
});
