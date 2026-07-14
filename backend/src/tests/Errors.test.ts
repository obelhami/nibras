/**
 * Unit tests : Error format standard (src/lib/errors.ts)
 *
 * Import direct des vraies fonctions exportées — aucune DB, aucun HTTP.
 * Usage : bun test src/tests/errors.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  fail,
  unauthorized,
  permissionDenied,
  forbidden,
  notFound,
  validationError,
  conflict,
  internalError,
} from '../lib/errors';

// ─── fail() — fonction de base ────────────────────────────────────────────────

describe('fail — construction générique de réponse d\'erreur', () => {
  test('fixe set.status et retourne message + code', () => {
    const set: { status?: number | string } = {};
    const result = fail(set, { status: 418, code: 'VALIDATION_ERROR', message: 'teapot' });
    expect(set.status).toBe(418);
    expect(result).toEqual({ message: 'teapot', code: 'VALIDATION_ERROR' });
  });

  test('inclut "details" seulement si fourni', () => {
    const set: { status?: number | string } = {};
    const withDetails = fail(set, {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'bad',
      details: { field: 'name' },
    });
    expect(withDetails).toHaveProperty('details', { field: 'name' });

    const withoutDetails = fail(set, { status: 400, code: 'VALIDATION_ERROR', message: 'bad' });
    expect(withoutDetails).not.toHaveProperty('details');
  });
});

// ─── Helpers par code HTTP ─────────────────────────────────────────────────────

describe('unauthorized — 401', () => {
  test('status 401, code UNAUTHORIZED, message par défaut', () => {
    const set: { status?: number | string } = {};
    const result = unauthorized(set);
    expect(set.status).toBe(401);
    expect(result.code).toBe('UNAUTHORIZED');
    expect(result.message).toBe('Unauthorized');
  });

  test('message personnalisé accepté', () => {
    const set: { status?: number | string } = {};
    const result = unauthorized(set, 'Token expired');
    expect(result.message).toBe('Token expired');
  });
});

describe('forbidden — 403', () => {
  test('status 403, code FORBIDDEN', () => {
    const set: { status?: number | string } = {};
    const result = forbidden(set);
    expect(set.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });
});

describe('notFound — 404', () => {
  test('status 404, code NOT_FOUND', () => {
    const set: { status?: number | string } = {};
    const result = notFound(set);
    expect(set.status).toBe(404);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Not found');
  });
});

describe('validationError — 400', () => {
  test('status 400, code VALIDATION_ERROR, avec details optionnels', () => {
    const set: { status?: number | string } = {};
    const result = validationError(set, 'Name is required', { field: 'name' });
    expect(set.status).toBe(400);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result).toHaveProperty('details', { field: 'name' });
  });
});

describe('conflict — 409', () => {
  test('status 409, code CONFLICT', () => {
    const set: { status?: number | string } = {};
    const result = conflict(set, 'Email already used');
    expect(set.status).toBe(409);
    expect(result.code).toBe('CONFLICT');
    expect(result.message).toBe('Email already used');
  });
});

describe('internalError — 500', () => {
  test('status 500, code INTERNAL_ERROR, message par défaut ne fuite pas de détails techniques', () => {
    const set: { status?: number | string } = {};
    const result = internalError(set);
    expect(set.status).toBe(500);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('Internal server error');
  });
});

// ─── permissionDenied — logique conditionnelle 401 vs 403 ────────────────────

describe('permissionDenied — respecte le status déjà fixé par requirePermission', () => {
  test('si set.status est déjà 403 (permission refusée) → reste 403 FORBIDDEN', () => {
    const set: { status?: number | string } = { status: 403 };
    const result = permissionDenied(set);
    expect(set.status).toBe(403);
    expect(result.code).toBe('FORBIDDEN');
  });

  test('si set.status n\'est PAS 403 (ex: token invalide) → 401 UNAUTHORIZED', () => {
    const set: { status?: number | string } = { status: 401 };
    const result = permissionDenied(set);
    expect(set.status).toBe(401);
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('si set.status est undefined → 401 UNAUTHORIZED par défaut', () => {
    const set: { status?: number | string } = {};
    const result = permissionDenied(set);
    expect(set.status).toBe(401);
    expect(result.code).toBe('UNAUTHORIZED');
  });
});