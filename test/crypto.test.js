// crypto.test.js — encryption, hashing, tokens, CSRF and form tokens.
// Argon2 cost is lowered through the environment so the run stays fast; the code path is the same as at full cost.
process.env.ARGON_MEMORY_KIB = '8192';
process.env.ARGON_TIME = '1';
process.env.ARGON_CONCURRENCY = '2';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import nodeCrypto from 'node:crypto';

const c = await import('../src/crypto.js');
const CRYPTO_URL = new URL('../src/crypto.js', import.meta.url).href;

// ---------- AES-256-GCM ----------

test('encrypt then decrypt returns the original text', () => {
  for (const text of ['hello', 'Zażółć 日本語 🙂', 'x'.repeat(10_000)]) {
    assert.equal(c.decrypt(c.encrypt(text)), text);
  }
});

test('the blob is [key id][12-byte IV][16-byte tag][ciphertext]', () => {
  const blob = c.encrypt('hello');
  assert.equal(blob[0], 1);
  assert.equal(blob.length, 1 + 12 + 16 + Buffer.byteLength('hello'));
});

test('every encryption uses a fresh IV, so equal inputs give different blobs', () => {
  assert.notDeepEqual(c.encrypt('same'), c.encrypt('same'));
});

test('additional authenticated data binds a blob to its purpose', () => {
  const blob = c.encrypt('secret', 'row-7');
  assert.equal(c.decrypt(blob, 'row-7'), 'secret');
  assert.throws(() => c.decrypt(blob, 'row-8'));
  assert.throws(() => c.decrypt(blob));
});

test('changing any part of a blob makes decryption throw', () => {
  const blob = c.encrypt('secret');
  for (const at of [5, 20, 30]) {                      // inside the IV, the tag and the ciphertext
    const bad = Buffer.from(blob);
    bad[at] ^= 0x01;
    assert.throws(() => c.decrypt(bad), `flipped byte ${at}`);
  }
});

test('a missing, short or unknown-key blob decrypts to null', () => {
  assert.equal(c.decrypt(null), null);
  assert.equal(c.decrypt(undefined), null);
  assert.equal(c.decrypt(Buffer.alloc(10)), null);
  const unknownKey = Buffer.from(c.encrypt('secret'));
  unknownKey[0] = 9;
  assert.equal(c.decrypt(unknownKey), null);
});

// ---------- Hashing, tokens, comparison ----------

test('sha256 matches a published test vector', () => {
  assert.equal(c.sha256('abc').toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('randomToken is URL-safe, the requested length and never repeats', () => {
  const t = c.randomToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);                    // 32 bytes in base64url
  assert.match(c.randomToken(16), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(new Set(Array.from({ length: 200 }, () => c.randomToken())).size, 200);
});

test('safeEqual compares strings in constant time and rejects different lengths', () => {
  assert.equal(c.safeEqual('abc', 'abc'), true);
  assert.equal(c.safeEqual('abc', 'abd'), false);
  assert.equal(c.safeEqual('abc', 'abcd'), false);
  assert.equal(c.safeEqual('', ''), true);
  assert.equal(c.safeEqual(12, '12'), true);                 // values are compared as text
});

test('ipKey is stable, short and different for different addresses', () => {
  assert.equal(c.ipKey('203.0.113.9'), c.ipKey('203.0.113.9'));
  assert.notEqual(c.ipKey('203.0.113.9'), c.ipKey('203.0.113.10'));
  assert.match(c.ipKey('203.0.113.9'), /^[A-Za-z0-9_-]{16}$/);
  assert.ok(!c.ipKey('203.0.113.9').includes('203'));
});

// ---------- Recovery codes ----------

test('a recovery code has four groups of five from the unambiguous alphabet', () => {
  for (let i = 0; i < 50; i++) assert.match(c.newRecoveryCode(), /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
  assert.equal(new Set(Array.from({ length: 100 }, () => c.newRecoveryCode())).size, 100);
});

test('recoveryHash ignores case, spaces and hyphens', () => {
  const code = c.newRecoveryCode();
  const h = c.recoveryHash(code);
  assert.equal(h.length, 32);
  assert.deepEqual(c.recoveryHash(code.toLowerCase()), h);
  assert.deepEqual(c.recoveryHash(code.replaceAll('-', ' ')), h);
});

test('recoveryHash refuses anything that cannot be a code', () => {
  for (const bad of ['', 'SHORT', 'ABCDEFGHIJKLMNOPQRST', '0000000000000000000O', 'ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2', null]) {
    assert.equal(c.recoveryHash(bad), null, String(bad));
  }
});

// ---------- Passwords (Argon2id) ----------

test('hashPassword writes a standard PHC string and verifyPassword accepts the right password only', async () => {
  const stored = await c.hashPassword('correct horse battery');
  assert.match(stored, /^\$argon2id\$v=19\$m=8192,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  assert.equal(await c.verifyPassword(stored, 'correct horse battery'), true);
  assert.equal(await c.verifyPassword(stored, 'correct horse batterY'), false);
  assert.equal(await c.verifyPassword(stored, ''), false);
});

test('the same password hashes differently each time (random salt)', async () => {
  assert.notEqual(await c.hashPassword('pw'), await c.hashPassword('pw'));
});

test('verifyPassword returns false for malformed stored values', async () => {
  const good = await c.hashPassword('pw');
  for (const bad of [null, undefined, '', 'plaintext', good.slice(0, -4) + '!!!!', good.replace('argon2id', 'argon2i')]) {
    assert.equal(await c.verifyPassword(bad, 'pw'), false, String(bad));
  }
});

test('verifyPassword refuses stored costs high enough to be a denial-of-service lever, without computing them', async (t) => {
  const argon2 = t.mock.method(nodeCrypto, 'argon2');
  for (const cost of ['m=262145,t=1,p=1', 'm=8192,t=11,p=1', 'm=8192,t=1,p=9']) {
    assert.equal(await c.verifyPassword(`$argon2id$v=19$${cost}$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2g`, 'pw'), false, cost);
  }
  assert.equal(argon2.mock.callCount(), 0, 'Argon2 never ran for an over-limit cost');
});

test('verifyPassword accepts stored costs at the limit', async (t) => {
  const argon2 = t.mock.method(nodeCrypto, 'argon2', (type, params, done) => done(null, Buffer.alloc(32)));
  await c.verifyPassword('$argon2id$v=19$m=262144,t=10,p=8$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2g', 'pw');
  assert.equal(argon2.mock.callCount(), 1, 'a cost exactly at the limit is computed');
});

test('burnPasswordTime always returns false', async () => {
  assert.equal(await c.burnPasswordTime('anything'), false);
});

test('a hash made under a different APP_SECRET does not verify (the pepper is part of the hash)', async () => {
  const script = `const c = await import(process.env.CRYPTO_URL); process.stdout.write(await c.hashPassword('pw'));`;
  const foreign = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CRYPTO_URL, APP_SECRET: 'another-secret-another-secret-another-secret' },
  }).toString();
  assert.match(foreign, /^\$argon2id\$/);
  assert.equal(await c.verifyPassword(foreign, 'pw'), false);
});

test('when the queue of waiting hashes is full, further requests fail with status 503', async () => {
  // Two hashes run at once and 201 may wait; the rest are refused immediately instead of piling up memory.
  const results = await Promise.allSettled(Array.from({ length: 260 }, () => c.hashPassword('pw')));
  const refused = results.filter(r => r.status === 'rejected');
  assert.ok(refused.length > 0, 'some requests were refused');
  assert.ok(refused.every(r => r.reason.status === 503), 'every refusal carries status 503');
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 260 - refused.length);
});

// ---------- CSRF and form tokens ----------

test('csrfFor is stable for one session token and different for another', () => {
  assert.equal(c.csrfFor('session-a'), c.csrfFor('session-a'));
  assert.notEqual(c.csrfFor('session-a'), c.csrfFor('session-b'));
  assert.match(c.csrfFor('session-a'), /^[A-Za-z0-9_-]{32}$/);
});

test('a fresh form token validates', () => {
  assert.equal(c.checkFormToken(c.formToken()), true);
});

test('an expired form token is refused', () => {
  assert.equal(c.checkFormToken(c.formToken(-1)), false);
});

test('a form token with a changed expiry, nonce or signature is refused', () => {
  const [exp, nonce, mac] = c.formToken().split('.');
  assert.equal(c.checkFormToken(`${Number(exp) + 9999}.${nonce}.${mac}`), false);
  assert.equal(c.checkFormToken(`${exp}.${c.randomToken(12)}.${mac}`), false);
  assert.equal(c.checkFormToken(`${exp}.${nonce}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`), false);
});

test('a form token of the wrong shape is refused', () => {
  for (const bad of [null, undefined, 42, '', 'a.b', 'a.b.c.d', `${c.formToken()}x`.padEnd(200, 'x')]) {
    assert.equal(c.checkFormToken(bad), false, String(bad));
  }
});
