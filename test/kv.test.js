// kv.test.js — the in-process store, the cache helper, and the network client against a fake RESP server.
// The fake server speaks just enough of the Redis wire protocol (RESP2) to exercise every code path of the client.
process.env.VALKEY_URL = 'memory';

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

const { Client, MemoryClient, kv, cached } = await import('../src/kv.js');

// ---------- Fake RESP server ----------

/** Encode helpers for the reply types the fake server uses. */
const simple = s => `+${s}\r\n`;
const error = s => `-${s}\r\n`;
const int = n => `:${n}\r\n`;
const bulk = s => (s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
const array = items => `*${items.length}\r\n${items.join('')}`;

/** Parse as many complete commands (arrays of bulk strings) as `buf` holds. Returns { commands, rest }. */
function readCommands(buf) {
  const commands = [];
  let pos = 0;
  for (;;) {
    if (buf[pos] !== 0x2a) break;                                  // '*'
    let eol = buf.indexOf('\r\n', pos);
    if (eol < 0) break;
    const n = Number(buf.toString('utf8', pos + 1, eol));
    let p = eol + 2;
    const args = [];
    for (let i = 0; i < n; i++) {
      eol = buf.indexOf('\r\n', p);
      if (eol < 0) { args.length = 0; break; }
      const len = Number(buf.toString('utf8', p + 1, eol));
      if (buf.length < eol + 2 + len + 2) { args.length = 0; break; }
      args.push(buf.toString('utf8', eol + 2, eol + 2 + len));
      p = eol + 2 + len + 2;
    }
    if (args.length !== n) break;
    commands.push(args);
    pos = p;
  }
  return { commands, rest: buf.subarray(pos) };
}

/**
 * Start a fake server. `opts.trickle` writes every reply one byte at a time; `opts.log` receives each command.
 * Supported: AUTH, SELECT, SET, GET, DEL, EXPIRE, HSET, HGETALL, MULTI/EXEC, EVAL, QUIT. A GET of "drop" kills the socket.
 */
async function fakeServer(opts = {}) {
  const store = new Map();
  const sockets = new Set();
  const server = net.createServer(sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = Buffer.alloc(0), queued = null;
    const write = text => (opts.trickle ? [...Buffer.from(text)].forEach(b => sock.write(Buffer.from([b]))) : sock.write(text));
    sock.on('data', chunk => {
      const parsed = readCommands(Buffer.concat([buf, chunk]));
      buf = parsed.rest;
      for (const args of parsed.commands) {
        opts.log?.(args);
        const [cmd, ...a] = args;
        if (cmd === 'MULTI') { queued = []; write(simple('OK')); continue; }
        if (queued && cmd !== 'EXEC') { queued.push(args); write(simple('QUEUED')); continue; }
        if (cmd === 'EXEC') { const out = queued.map(q => reply(q)); queued = null; write(array(out)); continue; }
        if (cmd === 'GET' && a[0] === 'drop') { sock.destroy(); return; }
        write(reply(args));
      }
    });
    sock.on('error', () => {});
  });

  /** The reply for one command. */
  function reply([cmd, ...a]) {
    switch (cmd) {
      case 'AUTH': return a.at(-1) === 'secret' ? simple('OK') : error('WRONGPASS invalid password');
      case 'SELECT': case 'QUIT': return simple('OK');
      case 'SET': store.set(a[0], a[1]); return simple('OK');
      case 'GET': return bulk(store.get(a[0]) ?? null);
      case 'DEL': return int(a.filter(k => store.delete(k)).length);
      case 'EXPIRE': return int(store.has(a[0]) ? 1 : 0);
      case 'HSET': store.set(a[0], Object.fromEntries(a.slice(1).reduce((p, v, i, all) => (i % 2 ? p : [...p, [v, all[i + 1]]]), []))); return int(a.length / 2 - 0.5);
      case 'HGETALL': return array(Object.entries(store.get(a[0]) ?? {}).flat().map(bulk));
      case 'EVAL': return a[0].includes('fail') ? error('ERR script failed') : array([int(7), int(1500)]);
      default: return error(`ERR unknown command ${cmd}`);
    }
  }

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: async () => { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); },
  };
}

const open = [];                                                   // servers and clients to tidy up after each test
afterEach(async () => { for (const closeIt of open.splice(0)) await closeIt(); });

/** Start a fake server and a connected client for it. */
async function connected(opts, path = '') {
  const server = await fakeServer(opts);
  const client = new Client(`redis://127.0.0.1:${server.port}${path}`);
  open.push(() => client.quit(), () => server.close());
  await client.connect();
  return { server, client };
}

// ---------- Client against the fake server ----------

test('the client sets, gets and deletes over the wire', async () => {
  const { client } = await connected();
  assert.equal(await client.set('k', 'v'), 'OK');
  assert.equal(await client.get('k'), 'v');
  assert.equal(await client.get('absent'), null);
  assert.equal(await client.del('k'), 1);
  assert.equal(await client.del([]), 0, 'an empty key list sends nothing');
});

test('replies split into one-byte chunks are reassembled correctly', async () => {
  const { client } = await connected({ trickle: true });
  await client.set('k', 'héllo wörld');                            // multi-byte characters exercise the length handling
  assert.equal(await client.get('k'), 'héllo wörld');
});

test('several commands in flight at once each get their own reply, in order', async () => {
  const { client } = await connected();
  await client.set('a', '1'); await client.set('b', '2'); await client.set('c', '3');
  assert.deepEqual(await Promise.all([client.get('a'), client.get('b'), client.get('c'), client.get('zz')]), ['1', '2', '3', null]);
});

test('HGETALL replies are turned into an object', async () => {
  const { client } = await connected();
  await client.hSet('h', { name: 'ada', role: 'admin' });
  assert.deepEqual(await client.hGetAll('h'), { name: 'ada', role: 'admin' });
  assert.deepEqual(await client.hGetAll('missing'), {});
});

test('MULTI/EXEC sends the queued commands together and returns EXEC’s results', async () => {
  const log = [];
  const { client } = await connected({ log: c => log.push(c[0]) });
  const result = await client.multi().hSet('h', { a: '1' }).expire('h', 60).exec();
  assert.deepEqual(result, [1, 1]);
  assert.deepEqual(log, ['MULTI', 'HSET', 'EXPIRE', 'EXEC']);
});

test('a script reply and a server error are both handled', async () => {
  const { client } = await connected();
  assert.deepEqual(await client.eval('return 1', { keys: ['k'], arguments: ['x'] }), [7, 1500]);
  await assert.rejects(client.eval('fail'), /ERR script failed/);
});

test('the password, user and database number in the URL are sent on connect', async () => {
  const log = [];
  const server = await fakeServer({ log: c => log.push(c) });
  const client = new Client(`redis://ada:secret@127.0.0.1:${server.port}/3`);
  open.push(() => client.quit(), () => server.close());
  await client.connect();
  assert.deepEqual(log, [['AUTH', 'ada', 'secret'], ['SELECT', '3']]);
});

test('a wrong password makes connect() fail', async () => {
  const server = await fakeServer();
  const client = new Client(`redis://:wrong@127.0.0.1:${server.port}`);
  open.push(() => client.quit(), () => server.close());
  await assert.rejects(client.connect(), /WRONGPASS/);
});

test('commands fail immediately while not connected instead of queueing up', async () => {
  const client = new Client('redis://127.0.0.1:1');
  await assert.rejects(client.get('k'), /not connected/);
  await assert.rejects(client.multi().expire('k', 1).exec(), /not connected/);
});

test('a dropped connection fails the waiting command, then the client reconnects by itself', async () => {
  const { client } = await connected();
  await client.set('k', 'v');
  await assert.rejects(client.get('drop'), /connection closed/);
  for (let i = 0; i < 40 && !client.isOpen; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(client.isOpen, true, 'reconnected');
  assert.equal(await client.get('k'), 'v');
});

test('quit() closes the connection and stops reconnecting', async () => {
  const { client } = await connected();
  await client.quit();
  assert.equal(client.isOpen, false);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(client.isOpen, false);
});

// ---------- In-process store ----------

test('strings: set, get, overwrite, delete', async () => {
  const m = new MemoryClient();
  assert.equal(await m.get('k'), null);
  assert.equal(await m.set('k', 'v'), 'OK');
  assert.equal(await m.get('k'), 'v');
  await m.set('k', 'w');
  assert.equal(await m.get('k'), 'w');
  assert.equal(await m.del(['k', 'absent']), 1);
  assert.equal(await m.get('k'), null);
});

test('an entry set with EX disappears when its time is up', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const m = new MemoryClient();
  await m.set('k', 'v', { EX: 10 });
  t.mock.timers.tick(9_000);
  assert.equal(await m.get('k'), 'v');
  t.mock.timers.tick(2_000);
  assert.equal(await m.get('k'), null);
});

test('expire() reports whether the key existed, and a refreshed expiry moves the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const m = new MemoryClient();
  assert.equal(await m.expire('absent', 5), 0);
  await m.set('k', 'v', { EX: 5 });
  t.mock.timers.tick(4_000);
  assert.equal(await m.expire('k', 5), 1);
  t.mock.timers.tick(4_000);
  assert.equal(await m.get('k'), 'v', 'alive 8 s after creation because the expiry was pushed back');
});

test('hashes: set fields, read one, read all, and missing keys are empty', async () => {
  const m = new MemoryClient();
  await m.hSet('h', { a: 1, b: 'two' });
  assert.equal(await m.hGet('h', 'a'), '1');
  assert.equal(await m.hGet('h', 'zz'), null);
  assert.deepEqual(await m.hGetAll('h'), { a: '1', b: 'two' });
  assert.deepEqual(await m.hGetAll('missing'), {});
  assert.equal(await m.hGet('missing', 'a'), null);
});

test('sets: add, list, remove', async () => {
  const m = new MemoryClient();
  await m.sAdd('s', 'x'); await m.sAdd('s', 'y'); await m.sAdd('s', 'x');
  assert.deepEqual((await m.sMembers('s')).sort(), ['x', 'y']);
  assert.equal(await m.sRem('s', 'x'), 1);
  assert.equal(await m.sRem('s', 'x'), 0);
  assert.deepEqual(await m.sMembers('s'), ['y']);
  assert.deepEqual(await m.sMembers('missing'), []);
});

test('reading a key as the wrong type gives an empty answer rather than an error', async () => {
  const m = new MemoryClient();
  await m.set('str', 'v');
  await m.hSet('hash', { a: '1' });
  assert.equal(await m.get('hash'), null);
  assert.equal(await m.hGet('str', 'a'), null);
  assert.deepEqual(await m.hGetAll('str'), {});
  assert.deepEqual(await m.sMembers('str'), []);
});

test('multi().exec() runs the queued commands in order', async () => {
  const m = new MemoryClient();
  const result = await m.multi().hSet('h', { a: '1' }).expire('h', 30).sAdd('s', 'x').exec();
  assert.deepEqual(result, [1, 1, 1]);
  assert.deepEqual(await m.hGetAll('h'), { a: '1' });
});

test('the counter script increments, starts the window on first use and reports the time left', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const m = new MemoryClient();
  const script = "redis.call('INCR', KEYS[1])";
  assert.deepEqual(await m.eval(script, { keys: ['c'], arguments: ['60000'] }), [1, 60000]);
  t.mock.timers.tick(10_000);
  assert.deepEqual(await m.eval(script, { keys: ['c'], arguments: ['60000'] }), [2, 50000]);
  await assert.rejects(m.eval('return 1'), /only the rate-limit script/);
});

test('keys() matches with * wildcards, and flushDb() empties the store', async () => {
  const m = new MemoryClient();
  await m.set('rl:a', '1'); await m.set('rl:b', '1'); await m.set('s:c', '1');
  assert.deepEqual((await m.keys('rl:*')).sort(), ['rl:a', 'rl:b']);
  assert.deepEqual(await m.keys('s.c'), [], 'a "." in the pattern is literal, not a wildcard');
  await m.flushDb();
  assert.deepEqual(await m.keys('*'), []);
});

test('the oldest keys are evicted first when the store is full', async () => {
  const m = new MemoryClient();
  m.maxKeys = 3;
  for (const k of ['a', 'b', 'c', 'd', 'e']) await m.set(k, '1');
  assert.deepEqual((await m.keys('*')).sort(), ['c', 'd', 'e']);
});

// ---------- cached() ----------

test('cached() runs the function once, then serves the stored result until it expires', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  await kv.connect();
  await kv.flushDb();
  let calls = 0;
  const load = async () => ({ n: ++calls });
  assert.deepEqual(await cached('feed', 30, load), { n: 1 });
  assert.deepEqual(await cached('feed', 30, load), { n: 1 }, 'served from the cache');
  t.mock.timers.tick(31_000);
  assert.deepEqual(await cached('feed', 30, load), { n: 2 }, 'recomputed after the time-to-live');
});

test('cached() still answers when the store is failing', async (t) => {
  t.mock.method(kv, 'get', async () => { throw new Error('store down'); });
  t.mock.method(kv, 'set', async () => { throw new Error('store down'); });
  assert.deepEqual(await cached('k', 30, async () => ({ ok: true })), { ok: true });
});
