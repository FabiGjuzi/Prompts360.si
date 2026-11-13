// markdown.test.js — what the renderer produces, and the guarantees it keeps for untrusted input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, plain } from '../src/markdown.js';

const REL = 'rel="nofollow ugc noopener noreferrer"';

test('raw HTML in the input is escaped, never passed through', () => {
  const out = markdown('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('paragraphs and soft line breaks', () => {
  assert.equal(markdown('a\nb\n\nc'), '<p>a<br>b</p>\n<p>c</p>');
  assert.equal(markdown('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(markdown(null), '');
  assert.equal(markdown(undefined), '');
});

test('bold, italic and strikethrough', () => {
  assert.equal(markdown('**b** *i* _j_ ~~s~~'), '<p><strong>b</strong> <em>i</em> <em>j</em> <del>s</del></p>');
});

test('an intra-word underscore is not italic', () => {
  assert.equal(markdown('snake_case_name'), '<p>snake_case_name</p>');
});

test('inline code is escaped and not formatted further', () => {
  assert.equal(markdown('`<b>`'), '<p><code>&lt;b&gt;</code></p>');
  assert.equal(markdown('`**x**`'), '<p><code>**x**</code></p>');
});

test('fenced code is escaped; an unterminated fence runs to the end', () => {
  assert.equal(markdown('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  assert.equal(markdown('```\nabc'), '<pre><code>abc</code></pre>');
});

test('headings start at h3 by default and the offset is adjustable', () => {
  assert.equal(markdown('# T'), '<h3>T</h3>');
  assert.equal(markdown('## T'), '<h4>T</h4>');
  assert.equal(markdown('###### T'), '<h6>T</h6>');
  assert.equal(markdown('# T', { min: 1, off: 0 }), '<h1>T</h1>');
});

test('lists, quotes and rules', () => {
  assert.equal(markdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(markdown('1. a\n2) b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(markdown('> a\n> b'), '<blockquote>a<br>b</blockquote>');
  assert.equal(markdown('---'), '<hr>');
});

test('a Markdown link becomes an anchor with a safe rel attribute', () => {
  assert.equal(markdown('[ok](https://example.com)'), `<p><a href="https://example.com" ${REL}>ok</a></p>`);
});

test('a bare URL is linked without its trailing punctuation', () => {
  assert.equal(markdown('See https://example.com/a.'), `<p>See <a href="https://example.com/a" ${REL}>https://example.com/a</a>.</p>`);
});

test('only http and https links are ever emitted', () => {
  for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,x)', '[x](ftp://example.com)']) {
    assert.ok(!markdown(bad).includes('<a '), `should not link: ${bad}`);
  }
});

test('a link label is escaped', () => {
  const out = markdown('[<img src=x onerror=1>](https://example.com)');
  assert.ok(out.includes('&lt;img'));
  assert.ok(!out.includes('<img'));
});

test('quotes inside a URL cannot add attributes to the anchor', () => {
  const out = markdown('[x](https://example.com/"onmouseover="y)');
  assert.equal(out.match(/<a [^>]*>/)[0], `<a href="https://example.com/&quot;onmouseover=&quot;y" ${REL}>`);
});

test('a backslash keeps a literal punctuation character', () => {
  assert.equal(markdown('\\*not italic\\*'), '<p>*not italic*</p>');
});

test('private-use placeholder characters in the input are stripped', () => {
  assert.equal(markdown('ab'), '<p>ab</p>');
});

test('pathological input renders in bounded time (no catastrophic backtracking)', () => {
  const inputs = [
    '*'.repeat(50_000),
    '_'.repeat(50_000),
    '['.repeat(50_000),
    '[a]('.repeat(10_000),
    `[x](https://${'a'.repeat(50_000)}`,
    `${'**a'.repeat(20_000)}`,
    `\`${'a'.repeat(50_000)}`,
  ];
  for (const input of inputs) {
    const start = performance.now();
    markdown(input);
    assert.ok(performance.now() - start < 2000, `slow on input starting ${JSON.stringify(input.slice(0, 12))}`);
  }
});

test('plain() strips formatting and collapses whitespace', () => {
  const src = '# Title\n\n**bold** [link](https://example.com) `code`\n\n```\nskipped\n```\n\n- item';
  assert.equal(plain(src), 'Title bold link code item');
  assert.equal(plain(null), '');
});
