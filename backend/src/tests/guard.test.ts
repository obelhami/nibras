/**
 * Unit tests : requirePermission (src/lib/guard.ts)
 *
 * guard.ts importe `db` (Turso) directement. On mock le module `../../db`
 * AVANT d'importer guard.ts pour tester le vrai code de production sans
 * jamais toucher une vraie base de données (et sans exiger TURSO_DATABASE_URL).
 *
 * Usage : bun test src/tests/guard.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createAccessToken } from '../lib/jwt';

// ─── Mock de la DB (doit être déclaré avant l'import de guard.ts) ────────────

type FakeUser = { id: number; username: string; email: string; role: string | null };

let dbRows: FakeUser[] = [];

const executeMock = mock(async (_query: { sql: string; args: unknown[] }) => {
  return { rows: dbRows as unknown[] } as any;
});

mock.module('../../db', () => ({
  db: { execute: executeMock },
}));

const { requirePermission } = await import('../lib/guard');

// ─── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbRows = [];
  executeMock.mockClear();
});

function tokenFor(email: string) {
  return `Bearer ${createAccessToken({ username: 'x', email })}`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('requirePermission — authentification', () => {
  test('header Authorization absent → 401, retourne null', async () => {
    const set: { status?: number | string } = {};
    const result = await requirePermission(undefined, 'create_task', set);
    expect(result).toBeNull();
    expect(set.status).toBe(401);
  });

  test('token invalide → 401, retourne null (aucune requête DB)', async () => {
    const set: { status?: number | string } = {};
    const result = await requirePermission('Bearer invalid-token', 'create_task', set);
    expect(result).toBeNull();
    expect(set.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('requirePermission — autorisation basée sur le rôle', () => {
  test('utilisateur introuvable en DB → 403, retourne null', async () => {
    dbRows = [];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('ghost@nibras.io'), 'create_task', set);
    expect(result).toBeNull();
    expect(set.status).toBe(403);
  });

  test('utilisateur sans rôle assigné (role=null) → 403', async () => {
    dbRows = [{ id: 1, username: 'x', email: 'x@nibras.io', role: null }];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('x@nibras.io'), 'create_task', set);
    expect(result).toBeNull();
    expect(set.status).toBe(403);
  });

  test('developer tente create_project (non autorisé) → 403', async () => {
    dbRows = [{ id: 1, username: 'dev', email: 'dev@nibras.io', role: 'developer' }];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('dev@nibras.io'), 'create_project', set);
    expect(result).toBeNull();
    expect(set.status).toBe(403);
  });

  test('developer tente create_task (autorisé) → retourne l\'utilisateur', async () => {
    dbRows = [{ id: 1, username: 'dev', email: 'dev@nibras.io', role: 'developer' }];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('dev@nibras.io'), 'create_task', set);
    expect(result).toEqual({ id: 1, username: 'dev', email: 'dev@nibras.io', role: 'developer' });
    expect(set.status).toBeUndefined();
  });

  test('manager tente view_team_kpis (autorisé) → retourne l\'utilisateur', async () => {
    dbRows = [{ id: 2, username: 'mgr', email: 'mgr@nibras.io', role: 'manager' }];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('mgr@nibras.io'), 'view_team_kpis', set);
    expect(result?.role).toBe('manager');
  });

  test('admin a accès à manage_users', async () => {
    dbRows = [{ id: 3, username: 'root', email: 'root@nibras.io', role: 'admin' }];
    const set: { status?: number | string } = {};
    const result = await requirePermission(tokenFor('root@nibras.io'), 'manage_users', set);
    expect(result?.role).toBe('admin');
  });

  test('la recherche utilisateur se fait bien par email du token (pas par id)', async () => {
    dbRows = [{ id: 9, username: 'y', email: 'y@nibras.io', role: 'admin' }];
    const set: { status?: number | string } = {};
    await requirePermission(tokenFor('y@nibras.io'), 'manage_users', set);
    const callArgs = executeMock.mock.calls[0]?.[0] as { sql: string; args: unknown[] };
    expect(callArgs.sql).toContain('WHERE email = ?');
    expect(callArgs.args).toEqual(['y@nibras.io']);
  });
});