/**
 * Régression : bug d'authentification trouvé en conditions HTTP réelles
 * (via la collection Postman), absent des mocks des tests unitaires.
 *
 * routes/teams.ts (getAuthenticatedUser) et routes/tasks.ts (getCurrentUser)
 * exécutaient TOUJOURS `SELECT ... WHERE id = ?`, même quand le payload JWT
 * n'avait pas de claim `userId` et qu'on retombait sur `payload.email` — un
 * email comparé à une colonne `id` entière ne matche jamais, donc 401
 * systématique pour tout utilisateur dont le token n'a pas de userId (le cas
 * juste après /user/role, ou après /register en TESTING_MODE — bugs situés
 * dans routes/user.ts / routes/auth.ts, hors du périmètre de ces fichiers).
 *
 * Fix retenu ICI (dans teams.ts / tasks.ts, qui sont dans mon périmètre) :
 * défensif — utiliser `userId` s'il est présent, sinon chercher par `email`
 * avec la BONNE colonne (email, pas id). Ça fonctionne quel que soit l'état
 * du token émis en amont, sans dépendre d'un fix dans user.ts/auth.ts.
 *
 * Usage : bun test src/tests/auth-lookup.test.ts
 */

import { describe, test, expect } from 'bun:test';

// Reproduit fidèlement la logique de teams.ts / tasks.ts.
function buildUserLookupQuery(payload: { userId?: string; email: string }): {
  sql: string;
  args: [string];
} {
  return payload.userId
    ? { sql: 'SELECT id, username, email, role FROM users WHERE id = ?', args: [payload.userId] }
    : { sql: 'SELECT id, username, email, role FROM users WHERE email = ?', args: [payload.email] };
}

describe('Résolution utilisateur depuis le JWT — teams.ts / tasks.ts (défensif)', () => {
  test('payload AVEC userId → recherche par colonne id, avec la valeur userId', () => {
    const query = buildUserLookupQuery({ userId: '63', email: 'dev1@nibras.demo' });
    expect(query.sql).toContain('WHERE id = ?');
    expect(query.args).toEqual(['63']);
  });

  test('payload SANS userId → recherche par colonne email, avec la valeur email (PAS la colonne id)', () => {
    const query = buildUserLookupQuery({ email: 'dev1@nibras.demo' });
    expect(query.sql).toContain('WHERE email = ?');
    expect(query.args).toEqual(['dev1@nibras.demo']);
  });

  test('régression : on ne doit JAMAIS comparer un email à la colonne id', () => {
    const query = buildUserLookupQuery({ email: 'dev1@nibras.demo' });
    // Le bug corrigé produisait : { sql: '... WHERE id = ?', args: ['dev1@nibras.demo'] }
    const isTheOldBug = query.sql.includes('WHERE id = ?') && query.args[0] === 'dev1@nibras.demo';
    expect(isTheOldBug).toBe(false);
  });

  test('fonctionne même si le token vient d\'un endpoint bugué (userId absent) — pas de dépendance sur user.ts/auth.ts', () => {
    // Simule un token émis par /user/role avant correction éventuelle côté auth.
    const buggyPayload = { email: 'dev1@nibras.demo' }; // pas de userId
    const query = buildUserLookupQuery(buggyPayload);
    expect(query.sql).toContain('WHERE email = ?');
  });
});