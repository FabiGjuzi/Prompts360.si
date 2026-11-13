// html.test.js — escaping, the html`` template, and the URL and redirect guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, raw, html, safeUrl, safeBack, slugify } from '../src/html.js';

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('esc turns non-string values into text first', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(0), '0');
});

test('html`` escapes every interpolated value', () => {
  const out = html`<p>${'<script>alert(1)</script>'}</p>`.toString();
  assert.equal(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('html`` leaves a nested html`` and raw() markup alone', () => {
  const inner = html`<b>${'a&b'}</b>`;
  assert.equal(html`<p>${inner}</p>`.toString(), '<p><b>a&amp;b</b></p>');
  assert.equal(html`<p>${raw('<i>x</i>')}</p>`.toString(), '<p><i>x</i></p>');
});

test('html`` drops null, undefined and false, and joins arrays', () => {
  assert.equal(html`${null}${undefined}${false}x`.toString(), 'x');
  assert.equal(html`<ul>${[1, 2].map(n => html`<li>${n}</li>`)}</ul>`.toString(), '<ul><li>1</li><li>2</li></ul>');
  assert.equal(html`${0}`.toString(), '0'); // zero is a value, not an absence
});

test('an attribute value cannot break out of its quotes', () => {
  const out = html`<a title="${'" onmouseover="alert(1)'}">x</a>`.toString();
  assert.equal(out, '<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
});

test('safeUrl accepts only absolute http(s) URLs', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('  http://example.com  '), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', '/relative', 'example.com', '', null, undefined]) {
    assert.equal(safeUrl(bad), null, `should reject ${bad}`);
  }
});

test('safeUrl rejects embedded credentials and very long URLs', () => {
  assert.equal(safeUrl('https://user:pw@example.com/'), null);
  assert.equal(safeUrl('https://user@example.com/'), null);
  assert.equal(safeUrl(`https://example.com/${'a'.repeat(2000)}`), null);
});

test('safeBack keeps same-site paths and blocks open redirects', () => {
  assert.equal(safeBack('/'), '/');
  assert.equal(safeBack('/a/b?x=1'), '/a/b?x=1');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a\nb', '/a\x00b', `/${'a'.repeat(500)}`, 42, null]) {
    assert.equal(safeBack(bad), '/', `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(safeBack('//evil.com', '/home'), '/home');
});

test('slugify makes a short lower-case ASCII slug', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('Ünïcode Tïtle'), 'unicode-title');
  assert.equal(slugify('  many   spaces__and-dashes '), 'many-spaces-and-dashes');
  assert.equal(slugify('a'.repeat(100)).length, 60);
  assert.equal(slugify(''), 'item');
  assert.equal(slugify('!!!'), 'item');
});
