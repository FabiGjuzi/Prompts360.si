// zip.test.js — the archive is checked by reading it back with an independent, minimal ZIP reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { zip } from '../src/zip.js';

/** Read every entry of a ZIP buffer through its central directory. Returns [{ name, data, crc, time, date }]. */
function readZip(buf) {
  const end = buf.length - 22;                                 // end-of-central-directory record (no archive comment)
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'end-of-central-directory signature');
  const count = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);                        // offset of the central directory
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'central directory signature');
    const time = buf.readUInt16LE(pos + 12), date = buf.readUInt16LE(pos + 14);
    const crc = buf.readUInt32LE(pos + 16), compressed = buf.readUInt32LE(pos + 20), size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28), extraLen = buf.readUInt16LE(pos + 30), commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'local header signature');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compressed));
    assert.equal(data.length, size, `size of ${name}`);
    entries.push({ name, data, crc, time, date });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('an archive reads back with the same names and contents', () => {
  const files = [
    { name: 'a.txt', data: 'hello' },
    { name: 'b.csv', data: Buffer.from('x,y\r\n1,2\r\n') },
    { name: 'empty.txt', data: '' },
    { name: 'big.txt', data: 'abc'.repeat(50_000) },
  ];
  const entries = readZip(zip(files));
  assert.deepEqual(entries.map(e => e.name), files.map(f => f.name));
  for (let i = 0; i < files.length; i++) assert.equal(entries[i].data.toString(), String(files[i].data));
});

test('each stored CRC-32 matches the file contents', () => {
  const entries = readZip(zip([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world' }]));
  for (const e of entries) assert.equal(e.crc, zlib.crc32(e.data));
});

test('non-ASCII contents survive', () => {
  const text = 'Zażółć gęślą jaźń — 日本語';
  assert.equal(readZip(zip([{ name: 'u.txt', data: text }]))[0].data.toString('utf8'), text);
});

test('the DOS timestamp encodes the given date', () => {
  const [e] = readZip(zip([{ name: 'a.txt', data: 'x' }], new Date(Date.UTC(2026, 10, 12, 21, 30, 44))));
  assert.equal(e.date, ((2026 - 1980) << 9) | (11 << 5) | 12);
  assert.equal(e.time, (21 << 11) | (30 << 5) | (44 >> 1));
});

test('an empty list gives a valid empty archive', () => {
  const buf = zip([]);
  assert.equal(buf.length, 22);
  assert.deepEqual(readZip(buf), []);
});

test('entry names that could escape a folder are refused', () => {
  for (const name of ['../x.txt', 'a/b.txt', 'a\\b.txt', '', 'has space.txt', 'a'.repeat(81)]) {
    assert.throws(() => zip([{ name, data: 'x' }]), /bad zip entry name/, `should refuse ${JSON.stringify(name)}`);
  }
});
