/**
 * Unit tests : JWT (src/lib/jwt.ts)
 *
 * Import direct des vraies fonctions — utilise `jsonwebtoken` réellement,
 * aucune DB, aucun appel HTTP. Le secret par défaut ('dev-secret-change-me')
 * est utilisé si JWT_SECRET n'est pas défini dans l'environnement de test.
 *
 * Usage : bun test src/tests/jwt.test.ts
 */

import { describe, test, expect } from 'bun:test';
import jsonwebtoken from 'jsonwebtoken';
import {
  createAccessToken,
  createRefreshToken,
  createVerificationToken,
  verifyAuthToken,
} from '../lib/jwt';

const USER = { id: '42', username: 'hiba', email: 'hiba@nibras.io', role: 'manager' };

// ─── createAccessToken ─────────────────────────────────────────────────────────

describe('createAccessToken', () => {
  test('génère un token vérifiable contenant userId, email, username, role', () => {
    const token = createAccessToken(USER);
    const decoded = verifyAuthToken(`Bearer ${token}`);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe('42');
    expect(decoded?.email).toBe(USER.email);
    expect(decoded?.username).toBe(USER.username);
    expect(decoded?.role).toBe('manager');
  });

  test('sans id fourni → pas de champ userId dans le payload', () => {
    const token = createAccessToken({ username: 'x', email: 'x@nibras.io' });
    const decoded = jsonwebtoken.decode(token) as Record<string, unknown>;
    expect(decoded).not.toHaveProperty('userId');
  });

  test('sans role fourni → pas de champ role dans le payload', () => {
    const token = createAccessToken({ username: 'x', email: 'x@nibras.io' });
    const decoded = jsonwebtoken.decode(token) as Record<string, unknown>;
    expect(decoded).not.toHaveProperty('role');
  });

  test('expire dans 15 minutes (JWT-01 constraint du projet Nibras)', () => {
    const token = createAccessToken(USER);
    const decoded = jsonwebtoken.decode(token) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });
});

// ─── createRefreshToken ────────────────────────────────────────────────────────

describe('createRefreshToken', () => {
  test('contient uniquement l\'email, expire dans 7 jours', () => {
    const token = createRefreshToken({ email: 'hiba@nibras.io' });
    const decoded = jsonwebtoken.decode(token) as { email: string; iat: number; exp: number };
    expect(decoded.email).toBe('hiba@nibras.io');
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });
});

// ─── createVerificationToken ──────────────────────────────────────────────────

describe('createVerificationToken', () => {
  test('contient purpose="verification", expire dans 24h', () => {
    const token = createVerificationToken({ username: 'hiba', email: 'hiba@nibras.io' });
    const decoded = jsonwebtoken.decode(token) as {
      purpose: string;
      iat: number;
      exp: number;
    };
    expect(decoded.purpose).toBe('verification');
    expect(decoded.exp - decoded.iat).toBe(24 * 60 * 60);
  });
});

// ─── verifyAuthToken ────────────────────────────────────────────────────────────

describe('verifyAuthToken — validation du header Authorization', () => {
  test('header absent → null', () => {
    expect(verifyAuthToken(undefined)).toBeNull();
  });

  test('header sans préfixe "Bearer " → null', () => {
    const token = createAccessToken(USER);
    expect(verifyAuthToken(token)).toBeNull(); // pas de "Bearer "
    expect(verifyAuthToken(`Token ${token}`)).toBeNull();
  });

  test('token malformé → null (pas d\'exception levée)', () => {
    expect(verifyAuthToken('Bearer not-a-real-jwt')).toBeNull();
  });

  test('token signé avec un AUTRE secret → rejeté (sécurité)', () => {
    const forged = jsonwebtoken.sign({ email: 'hacker@evil.com' }, 'wrong-secret', {
      expiresIn: '15m',
    });
    expect(verifyAuthToken(`Bearer ${forged}`)).toBeNull();
  });

  test('token expiré → null', () => {
    const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
    const expired = jsonwebtoken.sign({ email: USER.email, username: USER.username }, secret, {
      expiresIn: -10, // déjà expiré
    });
    expect(verifyAuthToken(`Bearer ${expired}`)).toBeNull();
  });

  test('token valide → retourne le payload complet avec iat/exp', () => {
    const token = createAccessToken(USER);
    const decoded = verifyAuthToken(`Bearer ${token}`);
    expect(decoded).toMatchObject({
      email: USER.email,
      username: USER.username,
      role: USER.role,
    });
    expect(typeof decoded?.iat).toBe('number');
    expect(typeof decoded?.exp).toBe('number');
  });

  test('token de vérification email n\'est pas confondu avec un access token (purpose distinct)', () => {
    const verifToken = createVerificationToken({ username: 'hiba', email: USER.email });
    const decoded = verifyAuthToken(`Bearer ${verifToken}`);
    expect(decoded?.purpose).toBe('verification');
  });
});