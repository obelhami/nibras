/**
 * Unit/integration tests : POST /auth/refresh (src/routes/token.ts)
 *
 * Contrairement aux autres fichiers de tests routes-*, celui-ci teste le VRAI
 * plugin Elysia via `app.handle(new Request(...))`, sans démarrer de serveur
 * HTTP réel et sans DB réelle (mock du module `../../db`).
 *
 * Usage : bun test src/tests/token-route.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import jsonwebtoken from 'jsonwebtoken';

type Row = Record<string, unknown>;

const fixtures: { refreshTokenRow: Row | null; userRow: Row | null } = {
  refreshTokenRow: null,
  userRow: null,
};

const executeMock = mock(async ({ sql }: { sql: string; args: unknown[] }) => {
  if (sql.includes('FROM refresh_tokens WHERE token')) {
    return { rows: fixtures.refreshTokenRow ? [fixtures.refreshTokenRow] : [] } as any;
  }
  if (sql.includes('DELETE FROM refresh_tokens')) {
    return { rows: [] } as any;
  }
  if (sql.includes('FROM users WHERE email')) {
    return { rows: fixtures.userRow ? [fixtures.userRow] : [] } as any;
  }
  return { rows: [] } as any;
});

mock.module('../../db', () => ({ db: { execute: executeMock } }));

const { default: tokenRoutes } = await import('../routes/token');

beforeEach(() => {
  fixtures.refreshTokenRow = null;
  fixtures.userRow = null;
  executeMock.mockClear();
});

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

function postRefresh(refreshToken: string) {
  return tokenRoutes.handle(
    new Request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),
  );
}

// Response.json() renvoie `Promise<unknown>` dans ce projet (pas `any`) :
// on caste explicitement la forme attendue pour pouvoir accéder aux champs.
type RefreshResponseBody = { message: string; accessToken?: string };

async function readJson(res: Response): Promise<RefreshResponseBody> {
  return (await res.json()) as RefreshResponseBody;
}

describe('POST /auth/refresh', () => {
  test('token inexistant en DB → 401 "Invalid refresh token"', async () => {
    fixtures.refreshTokenRow = null;
    const res = await postRefresh('unknown-token');
    const json = await readJson(res);
    expect(res.status).toBe(401);
    expect(json.message).toBe('Invalid refresh token');
  });

  test('token expiré en DB → 401 + suppression du token', async () => {
    fixtures.refreshTokenRow = {
      token: 'expired-token',
      email: 'dev@nibras.io',
      expires_at: '2020-01-01T00:00:00.000Z',
    };
    const res = await postRefresh('expired-token');
    const json = await readJson(res);
    expect(res.status).toBe(401);
    expect(json.message).toBe('Refresh token expired, please login again');

    const deleted = executeMock.mock.calls.some(([q]: any) => q.sql.includes('DELETE FROM refresh_tokens'));
    expect(deleted).toBe(true);
  });

  test('signature invalide (token altéré) → 401 "Invalid refresh token"', async () => {
    const forged = jsonwebtoken.sign({ email: 'dev@nibras.io' }, 'wrong-secret');
    const future = new Date();
    future.setDate(future.getDate() + 7);
    fixtures.refreshTokenRow = { token: forged, email: 'dev@nibras.io', expires_at: future.toISOString() };

    const res = await postRefresh(forged);
    const json = await readJson(res);
    expect(res.status).toBe(401);
    expect(json.message).toBe('Invalid refresh token');
  });

  test('token valide mais utilisateur supprimé entre-temps → 401 "User not found"', async () => {
    const valid = jsonwebtoken.sign({ email: 'ghost@nibras.io' }, JWT_SECRET);
    const future = new Date();
    future.setDate(future.getDate() + 7);
    fixtures.refreshTokenRow = { token: valid, email: 'ghost@nibras.io', expires_at: future.toISOString() };
    fixtures.userRow = null;

    const res = await postRefresh(valid);
    const json = await readJson(res);
    expect(res.status).toBe(401);
    expect(json.message).toBe('User not found');
  });

  test('token valide + utilisateur existant → 200, nouveau accessToken émis avec le bon rôle', async () => {
    const valid = jsonwebtoken.sign({ email: 'mgr@nibras.io' }, JWT_SECRET);
    const future = new Date();
    future.setDate(future.getDate() + 7);
    fixtures.refreshTokenRow = { token: valid, email: 'mgr@nibras.io', expires_at: future.toISOString() };
    fixtures.userRow = { id: '5', username: 'mgr', email: 'mgr@nibras.io', role: 'manager' };

    const res = await postRefresh(valid);
    const json = await readJson(res);
    expect(res.status).toBe(200);
    expect(json.message).toBe('Token refreshed successfully');
    expect(typeof json.accessToken).toBe('string');

    const decoded = jsonwebtoken.decode(json.accessToken as string) as Record<string, unknown>;
    expect(decoded.email).toBe('mgr@nibras.io');
    expect(decoded.role).toBe('manager');
  });

  test('body sans refreshToken → 422 (validation Elysia)', async () => {
    const res = await tokenRoutes.handle(
      new Request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(422);
  });
});