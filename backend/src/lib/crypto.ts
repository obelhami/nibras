/**
 * Symmetric encryption for secrets stored at rest (Trello OAuth tokens today;
 * any future integration token can reuse this instead of duplicating it).
 *
 * AES-256-GCM, key derived from TOKEN_ENCRYPTION_KEY via SHA-256 so any
 * length of env value still yields a valid 32-byte key. Falls back to a
 * dev-only key (same pattern as JWT_SECRET elsewhere in this codebase) —
 * set TOKEN_ENCRYPTION_KEY in production.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? 'dev-token-encryption-key';
  return crypto.createHash('sha256').update(secret).digest();
}

/** Encrypts a plaintext secret into a single `iv:authTag:ciphertext` hex string. */
export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Reverses encryptSecret(). Throws if the value is malformed or the key doesn't match. */
export function decryptSecret(cipherText: string): string {
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }
  const [ivHex, authTagHex, dataHex] = parts as [string, string, string];

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);

  return decrypted.toString('utf8');
}
