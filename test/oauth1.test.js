// OAuth 1.0a signing, against the worked example in X's documentation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percent, signature, authorization } from '../src/oauth1.js';

const OAUTH = { oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog', oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1318622958', oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', oauth_version: '1.0' };
const URL_ = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true';
const SECRETS = { consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' };
const PARAMS = { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' };

test('signature matches the documented example (query string and form parameters are both signed)', () => {
  assert.equal(signature({ method: 'POST', url: URL_, params: PARAMS, oauth: OAUTH, ...SECRETS }), 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
  assert.notEqual(signature({ method: 'POST', url: URL_, params: { status: 'changed' }, oauth: OAUTH, ...SECRETS }), 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
});

test('authorization header: sorted, percent-encoded, quoted', () => {
  const h = authorization({ method: 'POST', url: URL_, params: PARAMS, consumerKey: OAUTH.oauth_consumer_key, token: OAUTH.oauth_token, nonce: OAUTH.oauth_nonce, timestamp: 1318622958, ...SECRETS });
  assert.match(h, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="[^"]+", oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", oauth_token="[^"]+", oauth_version="1.0"$/);
});

test('percent encodes like RFC 3986 (encodeURIComponent leaves ! \' ( ) * alone)', () => {
  assert.equal(percent("a!b'c(d)e*f~g h"), 'a%21b%27c%28d%29e%2Af~g%20h');
});
