/**
 * Trello Connect — Unit tests : OAuth1 request-signing helpers (src/lib/trello.ts)
 *
 * The full connect/sync flow is DB- and network-bound (Trello API calls),
 * so this suite targets the pure, previously-untested building blocks of
 * the OAuth1 signature — the part most likely to silently break auth if
 * touched (wrong encoding, wrong param order, wrong base string).
 *
 * Usage :
 *   bun test src/tests/trello.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  oauthEncode,
  normalizedUrl,
  collectOAuthParams,
  buildNormalizedParamString,
  buildOAuthSignature,
  buildOAuthHeader,
} from '../lib/trello';

describe('oauthEncode', () => {
  test('percent-encodes spaces', () => {
    expect(oauthEncode('hello world')).toBe('hello%20world');
  });

  test('percent-encodes RFC3986 reserved characters encodeURIComponent leaves alone', () => {
    expect(oauthEncode("!'()*")).toBe('%21%27%28%29%2A');
  });

  test('leaves unreserved characters untouched', () => {
    expect(oauthEncode('abc123-_.~')).toBe('abc123-_.~');
  });
});

describe('normalizedUrl', () => {
  test('strips the query string', () => {
    expect(normalizedUrl('https://trello.com/1/OAuthGetRequestToken?foo=bar')).toBe(
      'https://trello.com/1/OAuthGetRequestToken',
    );
  });

  test('strips the default port for https', () => {
    expect(normalizedUrl('https://trello.com:443/path')).toBe('https://trello.com/path');
  });

  test('strips the default port for http', () => {
    expect(normalizedUrl('http://trello.com:80/path')).toBe('http://trello.com/path');
  });

  test('keeps a non-default port', () => {
    expect(normalizedUrl('https://trello.com:8443/path')).toBe('https://trello.com:8443/path');
  });
});

describe('collectOAuthParams', () => {
  test('merges query-string params from the URL with explicit params', () => {
    const params = collectOAuthParams('https://trello.com/1/path?a=1', { b: '2' });
    expect(params).toEqual({ a: '1', b: '2' });
  });

  test('explicit params override same-named query params', () => {
    const params = collectOAuthParams('https://trello.com/1/path?a=1', { a: '2' });
    expect(params.a).toBe('2');
  });
});

describe('buildNormalizedParamString', () => {
  test('sorts params alphabetically by key', () => {
    expect(buildNormalizedParamString({ b: '2', a: '1', c: '3' })).toBe('a=1&b=2&c=3');
  });

  test('percent-encodes keys and values', () => {
    expect(buildNormalizedParamString({ 'a b': 'c d' })).toBe('a%20b=c%20d');
  });
});

describe('buildOAuthSignature', () => {
  const url = 'https://trello.com/1/OAuthGetRequestToken';
  const baseParams = { oauth_consumer_key: 'ck', oauth_nonce: 'n1', oauth_timestamp: '1000' };

  test('is deterministic for the same inputs', () => {
    const sigA = buildOAuthSignature('POST', url, baseParams, 'secret');
    const sigB = buildOAuthSignature('POST', url, baseParams, 'secret');
    expect(sigA).toBe(sigB);
  });

  test('changes when the token secret changes', () => {
    const sigA = buildOAuthSignature('POST', url, baseParams, 'secret-one');
    const sigB = buildOAuthSignature('POST', url, baseParams, 'secret-two');
    expect(sigA).not.toBe(sigB);
  });

  test('changes when a param changes', () => {
    const sigA = buildOAuthSignature('POST', url, baseParams, 'secret');
    const sigB = buildOAuthSignature('POST', url, { ...baseParams, oauth_nonce: 'n2' }, 'secret');
    expect(sigA).not.toBe(sigB);
  });

  test('changes when the HTTP method changes', () => {
    const sigA = buildOAuthSignature('POST', url, baseParams, 'secret');
    const sigB = buildOAuthSignature('GET', url, baseParams, 'secret');
    expect(sigA).not.toBe(sigB);
  });

  test('produces a base64-looking string', () => {
    const sig = buildOAuthSignature('POST', url, baseParams, 'secret');
    expect(/^[A-Za-z0-9+/]+=*$/.test(sig)).toBe(true);
  });
});

describe('buildOAuthHeader', () => {
  test('only includes oauth_-prefixed keys', () => {
    const header = buildOAuthHeader({ oauth_token: 'abc', not_oauth: 'ignored' });
    expect(header).toContain('oauth_token="abc"');
    expect(header).not.toContain('not_oauth');
  });

  test('sorts oauth_ keys alphabetically', () => {
    const header = buildOAuthHeader({ oauth_token: 't', oauth_consumer_key: 'c' });
    const consumerIndex = header.indexOf('oauth_consumer_key');
    const tokenIndex = header.indexOf('oauth_token');
    expect(consumerIndex).toBeGreaterThanOrEqual(0);
    expect(tokenIndex).toBeGreaterThan(consumerIndex);
  });

  test('starts with the OAuth scheme prefix', () => {
    expect(buildOAuthHeader({ oauth_token: 'abc' }).startsWith('OAuth ')).toBe(true);
  });
});
