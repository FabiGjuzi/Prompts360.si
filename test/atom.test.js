// The Atom builder (pure string work).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomFeed, xmlEscape } from '../src/atom.js';

test('xmlEscape escapes the five XML characters and drops control characters XML forbids', () => {
  assert.equal(xmlEscape(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
  assert.equal(xmlEscape('a\u0000b\u0008c\u000Bd\ttab\nnl'), 'abcd\ttab\nnl');
  assert.equal(xmlEscape(null), '');
});

test('atomFeed: required Atom elements, escaped text, newest entry date as the feed date', () => {
  const xml = atomFeed({ title: 'T & <U>', subtitle: 'sub', selfUrl: 'https://x.test/feed.xml', siteUrl: 'https://x.test/', entries: [
    { id: 'https://x.test/p/1/a', title: 'One <b>', url: 'https://x.test/p/1/a', published: '2026-11-01T10:00:00Z', updated: '2026-11-02T10:00:00Z', author: 'sam', categories: ['Claude', 'c/Test'], summary: 'plain', html: '<p>Hi & bye</p>' },
    { id: 'https://x.test/p/2/b', title: 'Two', url: 'https://x.test/p/2/b', published: '2026-11-05T10:00:00Z', updated: '2026-11-05T10:00:00Z' },
  ] });
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<title>T &amp; &lt;U&gt;<\/title>/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/x\.test\/feed\.xml"\/>/);
  assert.match(xml, /<updated>2026-11-05T10:00:00\.000Z<\/updated><generator>/);
  assert.match(xml, /<entry><id>https:\/\/x\.test\/p\/1\/a<\/id><title>One &lt;b&gt;<\/title>/);
  assert.match(xml, /<author><name>sam<\/name><\/author><category term="Claude"\/><category term="c\/Test"\/>/);
  assert.match(xml, /<summary type="text">plain<\/summary><content type="html">&lt;p&gt;Hi &amp; bye&lt;\/p&gt;<\/content>/);
  assert.equal((xml.match(/<entry>/g) || []).length, 2);
  assert.doesNotMatch(xml, /<script/);
});

test('atomFeed with no entries is still a valid feed', () => {
  const xml = atomFeed({ title: 'Empty', selfUrl: 'https://x.test/f', siteUrl: 'https://x.test/', updated: '2026-01-01T00:00:00Z' });
  assert.match(xml, /<updated>2026-01-01T00:00:00\.000Z<\/updated>/); assert.doesNotMatch(xml, /<entry>/);
});
