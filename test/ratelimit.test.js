// ratelimit.test.js — the shared counter, its fail-closed behaviour, and the in-process per-IP throttle.
process.env.VALKEY_URL = 'memory';

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { kv } = await import('../src/kv.js');
const { hit, peek, reset, ipThrottle, LIMITS } = await import('../src/ratelimit.js');

beforeEach(async () => { await kv.connect(); await kv.flushDb(); });
afterEach(async (t) => { t.mock.timers.reset(); await kv.flushDb(); });

test('events up to the limit pass and the next one is refused', async () => {
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await hit('k', 3, 60));
  assert.deepEqual(results.map(r => r.ok), [true, true, true, false]);
  assert.deepEqual(results.map(r => r.count), [1, 2, 3, 4]);
});

test('retryAfter is between one second and the whole window', async () => {
  const { retryAfter } = await hit('k', 1, 60);
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `retryAfter ${retryAfter}`);
});

test('the window is fixed: the counter starts again when it ends', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  await hit('k', 1, 60);
  assert.equal((await hit('k', 1, 60)).ok, false);
  t.mock.timers.tick(59_000);
  assert.equal((await hit('k', 1, 60)).ok, false, 'still inside the window');
  t.mock.timers.tick(2_000);
  assert.deepEqual(await hit('k', 1, 60), { ok: true, retryAfter: 60, count: 1 });
});

test('different keys count separately', async () => {
  await hit('a', 1, 60);
  assert.equal((await hit('a', 1, 60)).ok, false);
  assert.equal((await hit('b', 1, 60)).ok, true);
});

test('peek reads the counter without adding to it, and reset clears it', async () => {
  assert.equal(await peek('k'), 0);
  await hit('k', 5, 60);
  await hit('k', 5, 60);
  assert.equal(await peek('k'), 2);
  assert.equal(await peek('k'), 2, 'peeking does not count');
  await reset('k');
  assert.equal(await peek('k'), 0);
});

test('when the store is unreachable the limiter refuses instead of allowing everything', async (t) => {
  t.mock.method(kv, 'eval', async () => { throw new Error('store down'); });
  t.mock.method(kv, 'get', async () => { throw new Error('store down'); });
  t.mock.method(kv, 'del', async () => { throw new Error('store down'); });
  assert.deepEqual(await hit('k', 100, 60), { ok: false, retryAfter: 30, count: Infinity });
  assert.equal(await peek('k'), Infinity);
  await reset('k');                                                // must not throw
});

test('LIMITS entries are [max, windowSeconds] pairs of positive integers', () => {
  for (const [name, [max, windowSec]] of Object.entries(LIMITS)) {
    assert.ok(Number.isInteger(max) && max > 0, `${name} max`);
    assert.ok(Number.isInteger(windowSec) && windowSec > 0, `${name} window`);
  }
});

// ---------- ipThrottle ----------

test('a burst up to the bucket size passes, then requests are refused', () => {
  const ip = 'burst-test';
  const passed = Array.from({ length: 7 }, () => ipThrottle(ip, 5, 1));
  assert.deepEqual(passed, [true, true, true, true, true, false, false]);
});

test('the bucket refills at the configured rate', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const ip = 'refill-test';
  for (let i = 0; i < 5; i++) ipThrottle(ip, 5, 2);
  assert.equal(ipThrottle(ip, 5, 2), false);
  t.mock.timers.tick(1000);                                        // 1 s at 2 per second = 2 tokens
  assert.deepEqual([ipThrottle(ip, 5, 2), ipThrottle(ip, 5, 2), ipThrottle(ip, 5, 2)], [true, true, false]);
});

test('the bucket never holds more than its burst size, however long the wait', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const ip = 'cap-test';
  ipThrottle(ip, 3, 1);
  t.mock.timers.tick(3_600_000);
  const passed = Array.from({ length: 5 }, () => ipThrottle(ip, 3, 1));
  assert.deepEqual(passed, [true, true, true, false, false]);
});

test('addresses are throttled independently', () => {
  assert.equal(ipThrottle('one', 1, 1), true);
  assert.equal(ipThrottle('one', 1, 1), false);
  assert.equal(ipThrottle('two', 1, 1), true);
});

test('memory is bounded: past 100,000 tracked addresses the table is cleared', () => {
  assert.equal(ipThrottle('victim', 1, 0), true);
  assert.equal(ipThrottle('victim', 1, 0), false);
  for (let i = 0; i < 100_001; i++) ipThrottle(`spray-${i}`, 1, 0);
  assert.equal(ipThrottle('victim', 1, 0), true, 'the old entry was forgotten when the table was cleared');
});
