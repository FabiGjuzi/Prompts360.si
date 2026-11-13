// netutil.test.js — public-address detection and IP parsing, including the range edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIp, v4ToNum, v6ToBig, parseIp } from '../src/netutil.js';

test('public addresses are recognised', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isPublicIp(ip), true, ip);
});

test('loopback, private, link-local, shared, multicast and unspecified addresses are not public', () => {
  const nonPublic = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1',
    '100.127.255.255', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1'];
  for (const ip of nonPublic) assert.equal(isPublicIp(ip), false, ip);
});

test('addresses just outside the private ranges are public', () => {
  for (const ip of ['172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '223.255.255.255']) {
    assert.equal(isPublicIp(ip), true, ip);
  }
});

test('anything that is not an IP address is not public', () => {
  for (const bad of ['example.com', '', '999.1.1.1', '1.2.3', 'localhost', '1.2.3.4/24']) assert.equal(isPublicIp(bad), false, bad);
});

test('v4ToNum converts a dotted quad and rejects malformed input', () => {
  assert.equal(v4ToNum('1.2.3.4'), 16909060);
  assert.equal(v4ToNum('255.255.255.255'), 4294967295);
  assert.equal(v4ToNum('0.0.0.0'), 0);
  for (const bad of ['1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.x', '']) assert.equal(v4ToNum(bad), null, bad);
});

test('v6ToBig expands :: and a trailing dotted IPv4, and ignores a zone id', () => {
  assert.equal(v6ToBig('::'), 0n);
  assert.equal(v6ToBig('::1'), 1n);
  assert.equal(v6ToBig('2001:db8::1'), 0x20010db8000000000000000000000001n);
  assert.equal(v6ToBig('::ffff:1.2.3.4'), 0xffff01020304n);
  assert.equal(v6ToBig('fe80::1%eth0'), v6ToBig('fe80::1'));
  assert.equal(v6ToBig('1.2.3.4'), null);
});

test('parseIp returns the family and number, treating IPv4-mapped IPv6 as IPv4', () => {
  assert.deepEqual(parseIp('1.2.3.4'), { fam: 4, n: 16909060n });
  assert.deepEqual(parseIp('::ffff:1.2.3.4'), { fam: 4, n: 16909060n });
  assert.deepEqual(parseIp('2001:db8::1'), { fam: 6, n: 0x20010db8000000000000000000000001n });
  assert.equal(parseIp('not an ip'), null);
});
