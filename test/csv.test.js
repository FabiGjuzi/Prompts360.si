// csv.test.js — parsing, writing, delimiter detection and spreadsheet formula-injection protection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseObjects, stringify, unprotect } from '../src/csv.js';

test('parse reads plain rows and skips blank lines', () => {
  assert.deepEqual(parse('a,b\n1,2\n\n3,4\n'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parse handles CRLF line ends and a leading byte-order mark', () => {
  assert.deepEqual(parse('﻿a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parse handles quoted commas, newlines and doubled quotes', () => {
  assert.deepEqual(parse('"a,b","line1\nline2","say ""hi"""\n'), [['a,b', 'line1\nline2', 'say "hi"']]);
});

test('parse detects semicolon and tab delimiters', () => {
  assert.deepEqual(parse('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parse('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('parse keeps an empty field between delimiters', () => {
  assert.deepEqual(parse('a,,c\n'), [['a', '', 'c']]);
});

test('parse reports a quote in the middle of a field, with its line number', () => {
  assert.throws(() => parse('a,b\nx"y,z'), /Line 2: a quote in the middle of a field/);
});

test('parse reports a quoted field that is never closed', () => {
  assert.throws(() => parse('a,"b\nc'), /never closed/);
});

test('parse enforces the row limit', () => {
  assert.throws(() => parse('a\nb\nc\n', { maxRows: 2 }), /Too many rows \(max 2\)/);
  assert.equal(parse('a\nb\n', { maxRows: 2 }).length, 2);
});

test('parseObjects keys records by lower-cased, trimmed headers and drops all-empty rows', () => {
  const { headers, records } = parseObjects(' Name , AGE \nAda,36\n,\nGrace,45\n');
  assert.deepEqual(headers, ['name', 'age']);
  assert.deepEqual(records, [{ _line: 2, name: 'Ada', age: '36' }, { _line: 4, name: 'Grace', age: '45' }]);
});

test('parseObjects numbers rows, not physical lines: blank lines are not counted', () => {
  // The blank line between the two records is skipped by parse(), so Grace is row 3 although she sits on line 4 of the text.
  const { records } = parseObjects('name\nAda\n\nGrace\n');
  assert.deepEqual(records.map(r => [r.name, r._line]), [['Ada', 2], ['Grace', 3]]);
});

test('parseObjects returns empty results for empty input', () => {
  assert.deepEqual(parseObjects(''), { headers: [], records: [] });
});

test('stringify writes CRLF line ends and a byte-order mark by default', () => {
  assert.equal(stringify(['a', 'b'], [['1', '2']]), '﻿a,b\r\n1,2\r\n');
  assert.equal(stringify(['a'], [['1']], { bom: false }), 'a\r\n1\r\n');
});

test('stringify quotes only the cells that need it', () => {
  const out = stringify(['h'], [['plain'], ['a,b'], ['say "hi"'], ['two\nlines'], [' padded '], ['semi;colon']], { bom: false });
  assert.equal(out, 'h\r\nplain\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n" padded "\r\n"semi;colon"\r\n');
});

test('stringify writes dates as ISO text, objects as JSON and null as empty', () => {
  const out = stringify(['d', 'o', 'n'], [[new Date('2026-01-02T03:04:05Z'), { a: 1 }, null]], { bom: false });
  assert.equal(out, 'd,o,n\r\n2026-01-02T03:04:05.000Z,"{""a"":1}",\r\n');
});

test('stringify defuses cells that a spreadsheet would run as formulas', () => {
  const out = stringify(['h'], [['=1+1'], ['+1+1'], ['-1+1x'], ['@SUM(A1)']], { bom: false });
  assert.equal(out, "h\r\n'=1+1\r\n'+1+1\r\n'-1+1x\r\n'@SUM(A1)\r\n");
});

test('stringify leaves real numbers alone, even negative ones', () => {
  assert.equal(stringify(['n'], [[-5], ['-5'], [3.5]], { bom: false }), 'n\r\n-5\r\n-5\r\n3.5\r\n');
});

test('stringify can switch the protection off', () => {
  assert.equal(stringify(['h'], [['=1+1']], { bom: false, protect: false }), 'h\r\n=1+1\r\n');
});

test('unprotect removes only the apostrophe the writer adds', () => {
  assert.equal(unprotect("'=1+1"), '=1+1');
  assert.equal(unprotect("'hello"), "'hello");
  assert.equal(unprotect('=1+1'), '=1+1');
  assert.equal(unprotect(42), 42);
});

test('a written file reads back to the original values', () => {
  const header = ['name', 'note'];
  const rows = [['Ada', 'likes, commas'], ['Bob', 'says "hi"'], ['Cy', 'two\nlines'], ['Di', '=HYPERLINK("x")'], ['', '']];
  const back = parse(stringify(header, rows));
  assert.deepEqual(back[0], header);
  assert.deepEqual(back.slice(1).map(r => r.map(unprotect)), rows);
});
