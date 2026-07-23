/**
 * Unit tests : logique métier de src/routes/auth.ts
 *
 * routes/auth.ts est un fichier de câblage Elysia (DB, Google OAuth, emails,
 * redirections HTTP) : il n'expose pas de fonctions pures. Comme pour
 * business-rules.test.ts, on extrait ici la logique métier RÉELLEMENT
 * présente dans le fichier (mêmes conditions, mêmes valeurs par défaut) et on
 * la teste isolément, sans DB, sans HTTP, sans Google.
 *
 * Usage : bun test src/tests/auth-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';

// ─── AUTH-google/callback : validation du state OAuth ────────────────────────

describe('Google OAuth callback — validation du state (anti-CSRF)', () => {
  function isValidState(state: string | undefined, store: Map<string, string>): boolean {
    return !!state && store.has(state);
  }

  test('state absent → invalide', () => {
    expect(isValidState(undefined, new Map())).toBe(false);
  });

  test('state inconnu du store (jamais émis par nous) → invalide', () => {
    const store = new Map([['legit-state', 'verifier']]);
    expect(isValidState('forged-state', store)).toBe(false);
  });

  test('state connu → valide', () => {
    const store = new Map([['legit-state', 'verifier']]);
    expect(isValidState('legit-state', store)).toBe(true);
  });

  test('le state est à usage unique : une fois consommé (delete), il redevient invalide', () => {
    const store = new Map([['s1', 'v1']]);
    expect(isValidState('s1', store)).toBe(true);
    store.delete('s1');
    expect(isValidState('s1', store)).toBe(false);
  });
});

// ─── Redirection post-login Google : dashboard vs choose-role ────────────────

describe('Google OAuth — redirection selon rôle existant', () => {
  function resolveRedirectPath(existingRole: string | null | undefined): string {
    return existingRole ? '/dashboard' : '/choose-role';
  }

  test('utilisateur avec un rôle déjà défini → /dashboard', () => {
    expect(resolveRedirectPath('manager')).toBe('/dashboard');
  });

  test('nouvel utilisateur sans rôle → /choose-role', () => {
    expect(resolveRedirectPath(null)).toBe('/choose-role');
    expect(resolveRedirectPath(undefined)).toBe('/choose-role');
  });
});

// ─── /auth/me : résolution du profil selon le type de payload JWT ────────────

describe('/auth/me — dérivation du fallback de nom depuis l\'email', () => {
  function emailLocalPart(email: string): string {
    return email.split('@')[0] ?? 'user';
  }

  test('extrait la partie locale d\'un email standard', () => {
    expect(emailLocalPart('hiba.nibras@heec.ma')).toBe('hiba.nibras');
  });

  test('chaîne vide → split("@")[0] renvoie "" (jamais undefined), le fallback "user" ne se déclenche donc jamais ici', () => {
    // Le `?? 'user'` du code source existe uniquement pour satisfaire TypeScript
    // (noUncheckedIndexedAccess type l'accès [0] comme `string | undefined`),
    // mais au runtime, ''.split('@') renvoie [''] : le premier élément est
    // toujours une string, jamais undefined. Le fallback est donc "mort" en
    // pratique pour ce cas précis.
    expect(emailLocalPart('')).toBe('');
  });

  test('email sans "@" (ex: nom d\'utilisateur brut) → renvoie la chaîne telle quelle', () => {
    expect(emailLocalPart('justastring')).toBe('justastring');
  });
});

// ─── /auth/send-verification : résolution du username en cascade ────────────

describe('send-verification — résolution du username (cascade de fallback)', () => {
  function resolveUsername(
    pendingUsername: string | undefined,
    tokenUsername: string | undefined,
    email: string,
  ): string {
    const emailFallback = email.split('@')[0] ?? 'user';
    return pendingUsername ?? tokenUsername ?? emailFallback;
  }

  test('priorité 1 : le username en attente (pending payload)', () => {
    expect(resolveUsername('Hiba', 'ignored', 'x@y.com')).toBe('Hiba');
  });

  test('priorité 2 : le username du token si aucun pending', () => {
    expect(resolveUsername(undefined, 'FromToken', 'x@y.com')).toBe('FromToken');
  });

  test('priorité 3 : dérivé de l\'email si rien d\'autre disponible', () => {
    expect(resolveUsername(undefined, undefined, 'jdoe@nibras.io')).toBe('jdoe');
  });

  test('rejette uniquement le fallback purpose "verification" (BR: seuls les signups en attente)', () => {
    function canRequestVerification(purpose: string | undefined): boolean {
      return purpose === 'verification';
    }
    expect(canRequestVerification('verification')).toBe(true);
    expect(canRequestVerification(undefined)).toBe(false);
    expect(canRequestVerification('access')).toBe(false);
  });
});

// ─── /auth/verify : expiration du token de vérification ──────────────────────

describe('verify — expiration du token de vérification (24h)', () => {
  function isTokenExpired(expiresAtIso: string, now: Date): boolean {
    return new Date(expiresAtIso) < now;
  }

  test('token expiré (date passée) → true', () => {
    expect(isTokenExpired('2020-01-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
  });

  test('token encore valide (date future) → false', () => {
    expect(isTokenExpired('2030-01-01T00:00:00.000Z', new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  test('expiresAt calculé à +24h depuis maintenant', () => {
    function buildExpiry(now: Date): Date {
      const expiresAt = new Date(now);
      expiresAt.setHours(expiresAt.getHours() + 24);
      return expiresAt;
    }
    const now = new Date('2026-06-01T10:00:00.000Z');
    const expiry = buildExpiry(now);
    expect(expiry.toISOString()).toBe('2026-06-02T10:00:00.000Z');
  });

  test('username vérifié retombe sur la partie locale de l\'email si le payload est vide', () => {
    function resolveVerifiedUsername(pendingUsername: string | undefined, userEmail: string): string {
      return pendingUsername ?? (userEmail.split('@')[0] ?? 'user');
    }
    expect(resolveVerifiedUsername(undefined, 'omar@nibras.io')).toBe('omar');
    expect(resolveVerifiedUsername('Omar B.', 'omar@nibras.io')).toBe('Omar B.');
  });
});