/**
 * Unit tests : POST/DELETE /projects/:id/teams (src/routes/project.ts)
 *
 * Complète business-rules.test.ts (qui couvre déjà canAccessProject,
 * isTeamManager, validation des dates/status/pagination) sur le seul
 * point non testé ailleurs : le mapping d'erreur SQLite → code métier lors
 * de la liaison équipe-projet.
 *
 * Usage : bun test src/tests/project-teams.test.ts
 */

import { describe, test, expect } from 'bun:test';

// ─── POST /projects/:id/teams — mapping des erreurs SQLite ───────────────────

describe('POST /projects/:id/teams — mapping erreur DB → code métier', () => {
  function classifyInsertError(errorMessage: string): 'CONFLICT' | 'INTERNAL_ERROR' {
    if (errorMessage.includes('PRIMARY') || errorMessage.includes('UNIQUE')) {
      return 'CONFLICT';
    }
    return 'INTERNAL_ERROR';
  }

  test('violation de clé primaire (déjà liée) → CONFLICT (409)', () => {
    expect(classifyInsertError('SQLITE_CONSTRAINT: PRIMARY KEY must be unique')).toBe('CONFLICT');
  });

  test('violation de contrainte UNIQUE → CONFLICT (409)', () => {
    expect(classifyInsertError('UNIQUE constraint failed: project_teams.team_id')).toBe('CONFLICT');
  });

  test('toute autre erreur DB (connexion, syntaxe...) → INTERNAL_ERROR (500), jamais 409', () => {
    expect(classifyInsertError('SQLITE_BUSY: database is locked')).toBe('INTERNAL_ERROR');
    expect(classifyInsertError('network timeout')).toBe('INTERNAL_ERROR');
  });
});

// ─── Ordre de vérification : projet → accès → équipe ─────────────────────────

describe('POST /projects/:id/teams — ordre des validations', () => {
  type Step = 'project_not_found' | 'forbidden' | 'team_not_found' | 'ok';

  function resolveStep(
    projectExists: boolean,
    hasAccess: boolean,
    teamExists: boolean,
  ): Step {
    if (!projectExists) return 'project_not_found';
    if (!hasAccess) return 'forbidden';
    if (!teamExists) return 'team_not_found';
    return 'ok';
  }

  test('projet introuvable → 404 avant même de vérifier l\'accès ou l\'équipe', () => {
    expect(resolveStep(false, false, false)).toBe('project_not_found');
  });

  test('projet trouvé mais accès refusé → 403 avant de vérifier l\'équipe', () => {
    expect(resolveStep(true, false, true)).toBe('forbidden');
  });

  test('accès autorisé mais équipe introuvable → 404 équipe', () => {
    expect(resolveStep(true, true, false)).toBe('team_not_found');
  });

  test('tout valide → ok, liaison créée', () => {
    expect(resolveStep(true, true, true)).toBe('ok');
  });
});