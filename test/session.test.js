// session.test.js — the session lifecycle on the in-process store, with a controllable clock for expiry.
process.env.VALKEY_URL = 'memory';

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { kv } = await import('../src/kv.js');
const { csrfFor, sha256 } = await import('../src/crypto.js');
const s = await import('../src/session.js');

const HOUR = 3600 * 1000;
const ada = { id: 1, username: 'ada', isAdmin: false };
const root = { id: 2, username: 'root_user', isAdmin: true };

beforeEach(async () => { await kv.connect(); await kv.flushDb(); });
afterEach(async (t) => { t.mock.timers.reset(); await kv.flushDb(); });

test('createSession returns a 256-bit URL-safe token that loadSession resolves', async () => {
  const token = await s.createSession(ada);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const session = await s.loadSession(token);
  assert.deepEqual({ ...session, csrf: undefined }, { id: 1, username: 'ada', isAdmin: false, csrf: undefined, token });
  assert.equal(session.csrf, csrfFor(token));
});

test('the admin flag round-trips', async () => {
  assert.equal((await s.loadSession(await s.createSession(root))).isAdmin, true);
  assert.equal((await s.loadSession(await s.createSession(ada))).isAdmin, false);
});

test('the raw token is never stored, only its SHA-256', async () => {
  const token = await s.createSession(ada);
  const keys = await kv.keys('*');
  assert.ok(keys.length >= 2, 'a session record and a per-user index');
  assert.ok(keys.every(k => !k.includes(token)), 'no key contains the token');
  const sessionKey = `s:${sha256(token).toString('base64url')}`;
  assert.ok(keys.includes(sessionKey));
  assert.ok(Object.values(await kv.hGetAll(sessionKey)).every(v => v !== token));
});

test('loadSession refuses a token it never issued', async () => {
  assert.equal(await s.loadSession('A'.repeat(43)), null);
});

test('loadSession refuses tokens of the wrong shape without even asking the store', async (t) => {
  const lookup = t.mock.method(kv, 'hGetAll');
  for (const bad of [null, undefined, '', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`, `${'A'.repeat(42)}=`]) {
    assert.equal(await s.loadSession(bad), null, String(bad));
  }
  assert.equal(lookup.mock.callCount(), 0, 'a malformed token never reaches the store');
});

test('destroySession ends one session and leaves the same user’s others alone', async () => {
  const first = await s.createSession(ada), second = await s.createSession(ada);
  await s.destroySession(first);
  assert.equal(await s.loadSession(first), null);
  assert.notEqual(await s.loadSession(second), null);
  await s.destroySession(null);                                    // a missing cookie is a no-op
});

test('destroyAllSessions revokes every session of one user and nobody else’s', async () => {
  const a1 = await s.createSession(ada), a2 = await s.createSession(ada), r1 = await s.createSession(root);
  await s.destroyAllSessions(ada.id);
  assert.equal(await s.loadSession(a1), null);
  assert.equal(await s.loadSession(a2), null);
  assert.notEqual(await s.loadSession(r1), null);
  await s.destroyAllSessions(999);                                 // a user with no sessions is fine
});

test('a session expires after 2 hours without use, and each use slides the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const token = await s.createSession(ada);
  for (let i = 0; i < 4; i++) {                                    // 4 x 90 min: alive far past 2 h because each visit refreshes it
    t.mock.timers.tick(1.5 * HOUR);
    assert.notEqual(await s.loadSession(token), null, `visit ${i + 1}`);
  }
  t.mock.timers.tick(2.1 * HOUR);                                  // then idle for more than 2 h
  assert.equal(await s.loadSession(token), null);
});

test('a session ends 24 hours after it began, however active it is', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const token = await s.createSession(ada);
  for (let i = 0; i < 15; i++) {                                   // active every 90 min for 22.5 h
    t.mock.timers.tick(1.5 * HOUR);
    assert.notEqual(await s.loadSession(token), null, `visit ${i + 1}`);
  }
  t.mock.timers.tick(1.6 * HOUR);                                  // 24.1 h after creation
  assert.equal(await s.loadSession(token), null);
  assert.equal(await kv.hGetAll(`s:${sha256(token).toString('base64url')}`).then(o => Object.keys(o).length), 0, 'the record is removed');
});

test('the cookie is HttpOnly, SameSite=Lax and has no expiry (it ends with the browser session)', () => {
  const header = s.cookieHeader('tok');
  assert.equal(header, 'sid=tok; Path=/; HttpOnly; SameSite=Lax');
  assert.ok(!/max-age|expires/i.test(header));
});

test('the clearing cookie expires immediately', () => {
  assert.equal(s.clearCookieHeader(), 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
});

test('readCookie finds the named cookie among several', () => {
  const req = { headers: { cookie: 'a=1; sid=abc; b=2' } };
  assert.equal(s.readCookie(req), 'abc');
  assert.equal(s.readCookie(req, 'b'), '2');
  assert.equal(s.readCookie(req, 'missing'), null);
});

test('readCookie matches the whole cookie name, keeps "=" inside values and trims spaces', () => {
  assert.equal(s.readCookie({ headers: { cookie: 'xsid=wrong; sid=right' } }), 'right');
  assert.equal(s.readCookie({ headers: { cookie: 'sid=a=b=c' } }), 'a=b=c');
  assert.equal(s.readCookie({ headers: { cookie: '  sid = padded  ' } }), 'padded');
});

test('readCookie returns null when there is no header or the header is oversized', () => {
  assert.equal(s.readCookie({ headers: {} }), null);
  assert.equal(s.readCookie({ headers: { cookie: `sid=abc; pad=${'x'.repeat(4100)}` } }), null);
});
