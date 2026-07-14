/**
 * Unit tests : logique métier de src/routes/user.ts
 *
 * Même approche que business-rules.test.ts : la logique est extraite
 * fidèlement (mêmes regex, mêmes conditions, mêmes valeurs) et testée sans
 * DB, sans bcrypt réel côté hashing ni HTTP.
 *
 * Usage : bun test src/tests/user-routes.test.ts
 */

import { describe, test, expect } from 'bun:test';

// ─── /register — validation email ──────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

describe('POST /register — validation du format email', () => {
  test('emails valides', () => {
    expect(EMAIL_REGEX.test('hiba@heec.ma')).toBe(true);
    expect(EMAIL_REGEX.test('hiba.dev+test@nibras.io')).toBe(true);
  });

  test('emails invalides', () => {
    expect(EMAIL_REGEX.test('hiba@')).toBe(false);
    expect(EMAIL_REGEX.test('hiba.com')).toBe(false);
    expect(EMAIL_REGEX.test('hiba @heec.ma')).toBe(false); // espace
    expect(EMAIL_REGEX.test('')).toBe(false);
  });
});

// ─── /register — confirmation de mot de passe ────────────────────────────────

describe('POST /register — confirmation du mot de passe', () => {
  function passwordsMatch(password: string, confirmPassword: string): boolean {
    return password === confirmPassword;
  }

  test('mots de passe identiques → valide', () => {
    expect(passwordsMatch('StrongPass123', 'StrongPass123')).toBe(true);
  });

  test('mots de passe différents → invalide', () => {
    expect(passwordsMatch('StrongPass123', 'OtherPass456')).toBe(false);
  });

  test('sensible à la casse', () => {
    expect(passwordsMatch('Pass123', 'pass123')).toBe(false);
  });
});

// ─── /register — vérification en attente déjà envoyée (BR anti-spam) ────────

describe('POST /register — vérification en attente (anti-doublon)', () => {
  function hasActivePendingVerification(expiresAtIso: string, now: Date): boolean {
    return new Date(expiresAtIso) > now;
  }

  test('demande de vérification encore valide → bloque un nouvel envoi (409)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(hasActivePendingVerification('2026-06-02T00:00:00.000Z', now)).toBe(true);
  });

  test('demande de vérification expirée → autorise un nouvel essai', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(hasActivePendingVerification('2026-05-01T00:00:00.000Z', now)).toBe(false);
  });
});

// ─── /user/role — validation du rôle ──────────────────────────────────────────

describe('POST /user/role — validation du rôle assigné', () => {
  const VALID_ROLES = ['admin', 'manager', 'developer'];

  test('rôles valides acceptés', () => {
    expect(VALID_ROLES.includes('admin')).toBe(true);
    expect(VALID_ROLES.includes('manager')).toBe(true);
    expect(VALID_ROLES.includes('developer')).toBe(true);
  });

  test('rôle invalide rejeté', () => {
    expect(VALID_ROLES.includes('superadmin')).toBe(false);
    expect(VALID_ROLES.includes('Admin')).toBe(false); // sensible à la casse
    expect(VALID_ROLES.includes('')).toBe(false);
  });

  test('BR : un rôle déjà assigné ne peut pas être réassigné (409)', () => {
    function canAssignRole(currentRole: string | null): boolean {
      return !currentRole;
    }
    expect(canAssignRole(null)).toBe(true);
    expect(canAssignRole('developer')).toBe(false);
  });
});

// ─── /login — conditions d'accès ──────────────────────────────────────────────

describe('POST /login — conditions préalables', () => {
  function canLogin(user: { is_verified?: number } | undefined): 'not_found' | 'not_verified' | 'ok' {
    if (!user) return 'not_found';
    if (user.is_verified !== 1) return 'not_verified';
    return 'ok';
  }

  test('utilisateur inexistant → not_found', () => {
    expect(canLogin(undefined)).toBe('not_found');
  });

  test('compte non vérifié (is_verified=0) → not_verified', () => {
    expect(canLogin({ is_verified: 0 })).toBe('not_verified');
  });

  test('is_verified manquant (undefined) → traité comme non vérifié', () => {
    expect(canLogin({})).toBe('not_verified');
  });

  test('compte vérifié → ok', () => {
    expect(canLogin({ is_verified: 1 })).toBe('ok');
  });
});

// ─── PATCH /profile — mise à jour conditionnelle ─────────────────────────────

describe('PATCH /profile — construction dynamique de la requête UPDATE', () => {
  function buildProfileUpdate(body: {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
    confirmNewPassword?: string;
  }): { updates: string[]; error?: string } {
    const updates: string[] = [];

    if (typeof body.username === 'string') {
      const trimmed = body.username.trim();
      if (!trimmed) return { updates: [], error: 'Username cannot be empty' };
      updates.push('username = ?');
    }

    const wantsPasswordChange =
      typeof body.currentPassword === 'string' ||
      typeof body.newPassword === 'string' ||
      typeof body.confirmNewPassword === 'string';

    if (wantsPasswordChange) {
      if (!body.currentPassword || !body.newPassword || !body.confirmNewPassword) {
        return { updates: [], error: 'Current password, new password, and confirmation are required' };
      }
      if (body.newPassword.length < 6) {
        return { updates: [], error: 'New password must be at least 6 characters long' };
      }
      if (body.newPassword !== body.confirmNewPassword) {
        return { updates: [], error: 'New passwords do not match' };
      }
      updates.push('password = ?');
    }

    if (updates.length === 0) {
      return { updates: [], error: 'No profile changes provided' };
    }

    return { updates };
  }

  test('aucun champ fourni → erreur "No profile changes provided"', () => {
    expect(buildProfileUpdate({}).error).toBe('No profile changes provided');
  });

  test('username vide (espaces uniquement) → erreur', () => {
    expect(buildProfileUpdate({ username: '   ' }).error).toBe('Username cannot be empty');
  });

  test('username seul, valide → 1 update, pas d\'erreur', () => {
    const result = buildProfileUpdate({ username: 'Hiba' });
    expect(result.updates).toEqual(['username = ?']);
    expect(result.error).toBeUndefined();
  });

  test('changement de mot de passe incomplet (champ manquant) → erreur', () => {
    expect(buildProfileUpdate({ newPassword: 'newpass123' }).error).toBe(
      'Current password, new password, and confirmation are required',
    );
  });

  test('nouveau mot de passe trop court (< 6 caractères) → erreur', () => {
    const result = buildProfileUpdate({
      currentPassword: 'old123',
      newPassword: 'abc',
      confirmNewPassword: 'abc',
    });
    expect(result.error).toBe('New password must be at least 6 characters long');
  });

  test('confirmation ne correspond pas → erreur', () => {
    const result = buildProfileUpdate({
      currentPassword: 'old123',
      newPassword: 'newpass123',
      confirmNewPassword: 'different456',
    });
    expect(result.error).toBe('New passwords do not match');
  });

  test('changement de mot de passe complet et valide → 1 update', () => {
    const result = buildProfileUpdate({
      currentPassword: 'old123',
      newPassword: 'newpass123',
      confirmNewPassword: 'newpass123',
    });
    expect(result.updates).toEqual(['password = ?']);
  });

  test('username + mot de passe en même temps → 2 updates', () => {
    const result = buildProfileUpdate({
      username: 'NewName',
      currentPassword: 'old123',
      newPassword: 'newpass123',
      confirmNewPassword: 'newpass123',
    });
    expect(result.updates).toEqual(['username = ?', 'password = ?']);
  });
});

// ─── Expiration des refresh tokens (login, register, role) ───────────────────

describe('Refresh token — expiration à 7 jours', () => {
  function buildRefreshExpiry(now: Date): Date {
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 7);
    return expiresAt;
  }

  test('expire exactement 7 jours après la création', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const expiry = buildRefreshExpiry(now);
    expect(expiry.toISOString()).toBe('2026-06-08T12:00:00.000Z');
  });
});