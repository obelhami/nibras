/**
 * Unit tests : encryption at rest for stored secrets (src/lib/crypto.ts)
 *
 * Used to encrypt Trello access_token/token_secret in trello_connections
 * (previously stored in plaintext). Pure functions, no DB.
 *
 * Usage :
 *   bun test src/tests/crypto.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { encryptSecret, decryptSecret } from '../lib/crypto';

describe('encryptSecret / decryptSecret', () => {
  test('round-trips a plaintext value', () => {
    const plain = 'super-secret-trello-token';
    const cipher = encryptSecret(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  test('round-trips an empty string', () => {
    const cipher = encryptSecret('');
    expect(decryptSecret(cipher)).toBe('');
  });

  test('round-trips unicode content', () => {
    const plain = 'jeton-clé-éàü-🔐';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  test('ciphertext never contains the plaintext', () => {
    const plain = 'super-secret-trello-token';
    expect(encryptSecret(plain)).not.toContain(plain);
  });

  test('encrypting the same value twice yields different ciphertext (random IV)', () => {
    const plain = 'same-input-both-times';
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  test('ciphertext has the iv:authTag:data hex format', () => {
    const cipher = encryptSecret('anything');
    const parts = cipher.split(':');
    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(/^[0-9a-f]+$/.test(part!)).toBe(true);
    }
  });

  test('decrypting a malformed value throws', () => {
    expect(() => decryptSecret('not-a-valid-cipher')).toThrow();
  });

  test('decrypting a tampered ciphertext throws (auth tag mismatch)', () => {
    const cipher = encryptSecret('trust-but-verify');
    const [iv, authTag, data] = cipher.split(':');
    const tamperedData = data!.slice(0, -2) + (data!.slice(-2) === '00' ? '11' : '00');
    expect(() => decryptSecret(`${iv}:${authTag}:${tamperedData}`)).toThrow();
  });
});
