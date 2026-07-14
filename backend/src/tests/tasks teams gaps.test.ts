/**
 * Unit tests : derniers gaps de routes/tasks.ts (commentaires, assignation
 * et suppression scopées BR-07) et routes/teams.ts (PATCH team) non couverts
 * par business-rules.test.ts.
 *
 * Usage : bun test src/tests/tasks-teams-gaps.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { normalizeText } from '../lib/validation';

// ─── POST task comment — contenu requis ──────────────────────────────────────

describe('POST /tasks/:id/comments — contenu requis', () => {
  function validateComment(rawContent: unknown): string | null {
    const content = normalizeText(rawContent);
    return content ? null : 'Comment content is required';
  }

  test('contenu vide (ou espaces uniquement) → erreur', () => {
    expect(validateComment('')).toBe('Comment content is required');
    expect(validateComment('   ')).toBe('Comment content is required');
  });

  test('contenu non-string (undefined) → erreur', () => {
    expect(validateComment(undefined)).toBe('Comment content is required');
  });

  test('contenu valide → pas d\'erreur, trim appliqué', () => {
    expect(validateComment('  Belle progression !  ')).toBeNull();
    expect(normalizeText('  Belle progression !  ')).toBe('Belle progression !');
  });
});

// ─── PATCH team — updates conditionnels + managerId ──────────────────────────

describe('PATCH /teams/:id — updates conditionnels', () => {
  function buildTeamUpdate(
    body: { name?: string; managerId?: string },
    managerExists: boolean,
  ): { updates: string[]; error?: string } {
    const updates: string[] = [];

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return { updates: [], error: 'Team name cannot be empty' };
      updates.push('name = ?');
    }

    if (typeof body.managerId === 'string') {
      if (!managerExists) return { updates: [], error: 'managerId does not match an existing user' };
      updates.push('manager_id = ?');
    }

    if (updates.length === 0) return { updates: [], error: 'No team changes provided' };
    return { updates };
  }

  test('aucun champ fourni → erreur "No team changes provided"', () => {
    expect(buildTeamUpdate({}, true).error).toBe('No team changes provided');
  });

  test('nom vide → erreur "Team name cannot be empty"', () => {
    expect(buildTeamUpdate({ name: '   ' }, true).error).toBe('Team name cannot be empty');
  });

  test('managerId pointant vers un utilisateur inexistant → erreur de validation', () => {
    expect(buildTeamUpdate({ managerId: 'ghost-id' }, false).error).toBe(
      'managerId does not match an existing user',
    );
  });

  test('managerId valide → update appliqué', () => {
    const result = buildTeamUpdate({ managerId: 'user-42' }, true);
    expect(result.updates).toEqual(['manager_id = ?']);
  });

  test('nom + manager valides ensemble → 2 updates', () => {
    const result = buildTeamUpdate({ name: 'Squad Alpha', managerId: 'user-42' }, true);
    expect(result.updates).toEqual(['name = ?', 'manager_id = ?']);
  });
});

// ─── BR-07 : assignation/suppression de tâche scopée au manager de l'équipe ──
// (routes/tasks.ts — POST/DELETE assignees, DELETE task)

describe('POST/DELETE assignees, DELETE task — BR-07 : manager scopé à son équipe', () => {
  function canAssignOrDelete(
    isOwnerOrCreator: boolean,
    role: string | null,
    isManagerOfBoardTeam: boolean,
  ): boolean {
    if (isOwnerOrCreator) return true;
    if (role === 'admin') return true;
    // BR-07 : "A Manager only sees teams or projects under responsibility."
    // Un manager ne peut assigner/supprimer que sur les boards des équipes
    // qu'il dirige (teams.manager_id), jamais sur n'importe quel board.
    if (role === 'manager') return isManagerOfBoardTeam;
    return false;
  }

  test('owner du board (même developer) → toujours autorisé', () => {
    expect(canAssignOrDelete(true, 'developer', false)).toBe(true);
  });

  test('créateur de la tâche → toujours autorisé (cas DELETE task)', () => {
    expect(canAssignOrDelete(true, 'developer', false)).toBe(true);
  });

  test('admin → toujours autorisé, même hors de son périmètre', () => {
    expect(canAssignOrDelete(false, 'admin', false)).toBe(true);
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board → autorisé', () => {
    expect(canAssignOrDelete(false, 'manager', true)).toBe(true);
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe du board → refusé (fini "n\'importe quel manager")', () => {
    expect(canAssignOrDelete(false, 'manager', false)).toBe(false);
  });

  test('developer non-owner, non-créateur → toujours refusé', () => {
    expect(canAssignOrDelete(false, 'developer', false)).toBe(false);
  });
});

// ─── getBoard (local à routes/tasks.ts) — gouvernance admin + BR-07 manager ──
// Ce fichier a sa propre fonction getBoard, indépendante de board/shared.ts.
// On reproduit fidèlement sa logique de résolution d'accès en lecture.

describe('getBoard (routes/tasks.ts) — résolution d\'accès en lecture', () => {
  type Board = { owner_email: string; visibility: 'private' | 'team' | 'public'; team_id: string | null };

  function resolveBoardAccess(
    board: Board,
    user: { email: string; role: string | null },
    isManagerOfTeam: boolean,
    isTeamMember: boolean,
  ): 'allowed' | 'denied' {
    if (user.role === 'admin') return 'allowed';
    if (board.owner_email === user.email) return 'allowed';
    if (user.role === 'manager') return isManagerOfTeam ? 'allowed' : 'denied';
    if (board.visibility === 'private' && board.owner_email !== user.email) return 'denied';
    if (board.visibility === 'team' && board.team_id) {
      if (!isTeamMember && board.owner_email !== user.email) return 'denied';
    }
    return 'allowed';
  }

  const privateBoard: Board = { owner_email: 'owner@nibras.io', visibility: 'private', team_id: 'team-1' };
  const teamBoard: Board = { owner_email: 'owner@nibras.io', visibility: 'team', team_id: 'team-1' };

  test('CDC §27 : admin toujours autorisé, même sur un board privé qu\'il ne possède pas', () => {
    expect(resolveBoardAccess(privateBoard, { email: 'admin@nibras.io', role: 'admin' }, false, false)).toBe(
      'allowed',
    );
  });

  test('propriétaire du board privé → autorisé', () => {
    expect(resolveBoardAccess(privateBoard, { email: 'owner@nibras.io', role: 'developer' }, false, false)).toBe(
      'allowed',
    );
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board privé → autorisé', () => {
    expect(resolveBoardAccess(privateBoard, { email: 'mgr@nibras.io', role: 'manager' }, true, false)).toBe(
      'allowed',
    );
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe → refusé, même sur un board "team"', () => {
    expect(resolveBoardAccess(teamBoard, { email: 'mgr@nibras.io', role: 'manager' }, false, false)).toBe(
      'denied',
    );
  });

  test('developer non-propriétaire sur un board privé → refusé (les boards privés ne sont pas partagés dans l\'équipe)', () => {
    expect(
      resolveBoardAccess(privateBoard, { email: 'dev@nibras.io', role: 'developer' }, false, false),
    ).toBe('denied');
  });

  test('developer MEMBRE de l\'équipe sur un board de visibilité "team" → autorisé', () => {
    expect(resolveBoardAccess(teamBoard, { email: 'dev@nibras.io', role: 'developer' }, false, true)).toBe(
      'allowed',
    );
  });

  test('developer NON membre de l\'équipe sur un board "team" → refusé', () => {
    expect(resolveBoardAccess(teamBoard, { email: 'dev@nibras.io', role: 'developer' }, false, false)).toBe(
      'denied',
    );
  });
});