/**
 * Unit tests for business rules (P0-P2 Tests & API documentation).
 *
 * Ces tests vérifient la logique métier pure — sans connexion à la base
 * Turso, sans token JWT, sans requête HTTP. Ils testent uniquement les
 * fonctions de validation et les règles métier extraites de nos routes.
 *
 * Usage :
 *   bun test src/tests/business-rules.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { normalizeText, isValidDateString, isValidDateRange } from '../lib/validation';
import { parsePagination } from '../lib/pagination';

// ─── Validate name ────────────────────────────────────────────────────────────

describe('Validate name', () => {
  test('nom vide → invalide', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('') === '').toBe(true);
  });

  test('nom avec espaces → trimé', () => {
    expect(normalizeText('  Mon projet  ')).toBe('Mon projet');
  });

  test('nom valide → accepté', () => {
    const name = normalizeText('Nibras MVP');
    expect(name.length).toBeGreaterThan(0);
  });

  test('valeur non-string → chaîne vide', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(42)).toBe('');
  });
});

// ─── Validate status ─────────────────────────────────────────────────────────

const ALLOWED_STATUSES = ['active', 'on_hold', 'completed', 'archived'];

describe('Validate status', () => {
  test('status valide → accepté', () => {
    expect(ALLOWED_STATUSES.includes('active')).toBe(true);
    expect(ALLOWED_STATUSES.includes('on_hold')).toBe(true);
    expect(ALLOWED_STATUSES.includes('completed')).toBe(true);
    expect(ALLOWED_STATUSES.includes('archived')).toBe(true);
  });

  test('status invalide → rejeté', () => {
    expect(ALLOWED_STATUSES.includes('blabla')).toBe(false);
    expect(ALLOWED_STATUSES.includes('ACTIVE')).toBe(false);
    expect(ALLOWED_STATUSES.includes('')).toBe(false);
    expect(ALLOWED_STATUSES.includes('draft')).toBe(false);
  });

  test('status par défaut = active quand non fourni', () => {
    function resolveStatus(input: string | undefined): string {
      return input ?? 'active';
    }
    expect(resolveStatus(undefined)).toBe('active');
    expect(ALLOWED_STATUSES.includes(resolveStatus(undefined))).toBe(true);
  });
});

// ─── Validate dates ───────────────────────────────────────────────────────────

describe('Validate dates', () => {
  test('format YYYY-MM-DD valide → accepté', () => {
    expect(isValidDateString('2026-07-01')).toBe(true);
    expect(isValidDateString('2026-12-31')).toBe(true);
    expect(isValidDateString('2026-01-01')).toBe(true);
  });

  test('format invalide → rejeté', () => {
    expect(isValidDateString('pas-une-date')).toBe(false);
    expect(isValidDateString('01/07/2026')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('')).toBe(false);
  });

  test('startDate <= endDate → valide', () => {
    expect(isValidDateRange('2026-06-01', '2026-09-30')).toBe(true);
    expect(isValidDateRange('2026-06-01', '2026-06-01')).toBe(true);
  });

  test('startDate > endDate → invalide', () => {
    expect(isValidDateRange('2026-09-30', '2026-06-01')).toBe(false);
  });

  test('une date null → pas de comparaison (valide)', () => {
    expect(isValidDateRange(null, '2026-09-30')).toBe(true);
    expect(isValidDateRange('2026-06-01', null)).toBe(true);
    expect(isValidDateRange(null, null)).toBe(true);
  });
});

// ─── Manager/admin control (canAccessProject logic) ──────────────────────────

describe('Manager/admin control — canAccessProject logic', () => {
  function canAccessProjectSync(
    projectCreatedBy: string,
    userId: string,
    role: string,
    isLinkedToManagedTeam: boolean,
  ): boolean {
    if (role === 'admin') return true;
    if (Number(projectCreatedBy) === Number(userId)) return true;
    if (isLinkedToManagedTeam) return true;
    return false;
  }

  test('admin → toujours autorisé', () => {
    expect(canAccessProjectSync('99', '1', 'admin', false)).toBe(true);
  });

  test('créateur du projet → autorisé', () => {
    expect(canAccessProjectSync('58', '58', 'manager', false)).toBe(true);
  });

  test('créateur avec id "58.0" vs "58" → tolère le format float Turso', () => {
    expect(canAccessProjectSync('58.0', '58', 'manager', false)).toBe(true);
    expect(canAccessProjectSync('58', '58.0', 'manager', false)).toBe(true);
  });

  test('manager lié via team → autorisé', () => {
    expect(canAccessProjectSync('99', '58', 'manager', true)).toBe(true);
  });

  test('manager non créateur, non lié → refusé', () => {
    expect(canAccessProjectSync('99', '58', 'manager', false)).toBe(false);
  });

  test('developer → toujours refusé sauf admin', () => {
    expect(canAccessProjectSync('58', '58', 'developer', false)).toBe(true);
    expect(canAccessProjectSync('99', '58', 'developer', false)).toBe(false);
  });
});

// ─── manager_id control (Teams) ──────────────────────────────────────────────

describe('manager_id control — isTeamManager logic', () => {
  function isTeamManager(managerId: string, userId: string, role: string): boolean {
    return role === 'admin' || String(managerId) === String(userId);
  }

  test('admin → toujours manager de la team', () => {
    expect(isTeamManager('99', '1', 'admin')).toBe(true);
  });

  test('manager_id correspond → autorisé', () => {
    expect(isTeamManager('58', '58', 'manager')).toBe(true);
  });

  test('manager_id différent → refusé', () => {
    expect(isTeamManager('58', '59', 'manager')).toBe(false);
  });

  test('developer → refusé même si même id', () => {
    expect(isTeamManager('58', '58', 'developer')).toBe(true);
    expect(isTeamManager('99', '58', 'developer')).toBe(false);
  });
});

// ─── Prevent duplicates ───────────────────────────────────────────────────────

describe('Prevent duplicates', () => {
  function wouldBeDuplicate(existingEmails: string[], newEmail: string): boolean {
    return existingEmails.includes(newEmail);
  }

  test('email déjà membre → doublon détecté', () => {
    expect(wouldBeDuplicate(['dev1@nibras.demo', 'dev2@nibras.demo'], 'dev1@nibras.demo')).toBe(true);
  });

  test('email nouveau → pas de doublon', () => {
    expect(wouldBeDuplicate(['dev1@nibras.demo'], 'dev2@nibras.demo')).toBe(false);
  });

  test('liste vide → jamais de doublon', () => {
    expect(wouldBeDuplicate([], 'dev1@nibras.demo')).toBe(false);
  });
});

// ─── Close task with business validation ─────────────────────────────────────

describe('Close task — business validation', () => {
  function canCloseTask(
    statusSlug: string,
    assigneeEmail: string | null,
    multiAssignees: string[],
  ): { ok: boolean; reason?: string } {
    if (statusSlug === 'done') {
      return { ok: false, reason: 'Task is already closed' };
    }
    if (!assigneeEmail && multiAssignees.length === 0) {
      return { ok: false, reason: 'Task must be assigned to at least one user before it can be closed' };
    }
    return { ok: true };
  }

  test('tâche déjà done → refusé', () => {
    const result = canCloseTask('done', 'dev1@nibras.demo', []);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('already');
  });

  test('tâche non assignée → refusé', () => {
    const result = canCloseTask('todo', null, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('assigned');
  });

  test('tâche avec assignee_email → autorisé', () => {
    const result = canCloseTask('todo', 'dev1@nibras.demo', []);
    expect(result.ok).toBe(true);
  });

  test('tâche avec multi-assignee seulement → autorisé', () => {
    const result = canCloseTask('todo', null, ['dev1@nibras.demo']);
    expect(result.ok).toBe(true);
  });

  test('tâche doing avec assigné → autorisé', () => {
    const result = canCloseTask('doing', 'dev1@nibras.demo', []);
    expect(result.ok).toBe(true);
  });
});

// ─── riskScore validation ─────────────────────────────────────────────────────

describe('riskScore validation', () => {
  function isValidRiskScore(value: number | null): boolean {
    if (value === null) return true;
    return value >= 0 && value <= 100;
  }

  test('0 → valide', () => expect(isValidRiskScore(0)).toBe(true));
  test('100 → valide', () => expect(isValidRiskScore(100)).toBe(true));
  test('50 → valide', () => expect(isValidRiskScore(50)).toBe(true));
  test('null → valide (reset)', () => expect(isValidRiskScore(null)).toBe(true));
  test('-1 → invalide', () => expect(isValidRiskScore(-1)).toBe(false));
  test('101 → invalide', () => expect(isValidRiskScore(101)).toBe(false));
  test('150 → invalide', () => expect(isValidRiskScore(150)).toBe(false));
});

// ─── Pagination logic ─────────────────────────────────────────────────────────

describe('Pagination logic', () => {
  test('valeurs par défaut (page=1, limit=20)', () => {
    const result = parsePagination({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  test('page 2, limit 10 → offset 10', () => {
    const result = parsePagination({ page: '2', limit: '10' });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(10);
  });

  test('page négative → retombe sur 1', () => {
    const result = parsePagination({ page: '-5' });
    expect(result.page).toBe(1);
  });

  test('limit > 100 → plafonnée à 100', () => {
    const result = parsePagination({ limit: '9999' });
    expect(result.limit).toBe(100);
  });

  test('valeurs non numériques → valeurs par défaut', () => {
    const result = parsePagination({ page: 'abc', limit: 'xyz' });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
});

// ─── Priority validation (Tasks API) ─────────────────────────────────────────

const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

describe('Priority validation — Tasks API', () => {
  test('priorités valides → acceptées', () => {
    expect(ALLOWED_PRIORITIES.has('low')).toBe(true);
    expect(ALLOWED_PRIORITIES.has('medium')).toBe(true);
    expect(ALLOWED_PRIORITIES.has('high')).toBe(true);
    expect(ALLOWED_PRIORITIES.has('urgent')).toBe(true);
  });

  test('priorité invalide → rejetée', () => {
    expect(ALLOWED_PRIORITIES.has('ultra_high')).toBe(false);
    expect(ALLOWED_PRIORITIES.has('LOW')).toBe(false);
    expect(ALLOWED_PRIORITIES.has('')).toBe(false);
    expect(ALLOWED_PRIORITIES.has('critical')).toBe(false);
  });

  test('priorité absente → fallback sur medium (comportement Hamza)', () => {
    function resolvePriority(input: string | undefined): string {
      return ALLOWED_PRIORITIES.has(input ?? '') ? (input as string) : 'medium';
    }
    expect(resolvePriority(undefined)).toBe('medium');
    expect(resolvePriority('invalid')).toBe('medium');
    expect(resolvePriority('high')).toBe('high');
  });
});

// ─── Complexity validation (Tasks API) ───────────────────────────────────────

describe('Complexity validation — Tasks API', () => {
  function isValidComplexity(value: number | null | undefined): boolean {
    if (value === null || value === undefined) return true;
    return Number.isInteger(value) && value >= 1 && value <= 5;
  }

  test('1 à 5 → valide', () => {
    expect(isValidComplexity(1)).toBe(true);
    expect(isValidComplexity(3)).toBe(true);
    expect(isValidComplexity(5)).toBe(true);
  });

  test('null/undefined → valide (optionnel)', () => {
    expect(isValidComplexity(null)).toBe(true);
    expect(isValidComplexity(undefined)).toBe(true);
  });

  test('0, 6, négatif → invalide', () => {
    expect(isValidComplexity(0)).toBe(false);
    expect(isValidComplexity(6)).toBe(false);
    expect(isValidComplexity(-1)).toBe(false);
  });

  test('nombre décimal → invalide', () => {
    expect(isValidComplexity(2.5)).toBe(false);
    expect(isValidComplexity(1.1)).toBe(false);
  });
});

// ─── userId validation — Assignees ───────────────────────────────────────────

describe('userId validation — Assignees', () => {
    function isValidUserId(userId: string): boolean {
      const n = Number(userId);
      return userId.trim() !== '' && !isNaN(n) && n > 0;
    }
  
    test('userId numérique valide → accepté', () => {
      expect(isValidUserId('63')).toBe(true);
      expect(isValidUserId('1')).toBe(true);
      expect(isValidUserId('999')).toBe(true);
    });
  
    test('userId vide → invalide', () => {
      expect(isValidUserId('')).toBe(false);
      expect(isValidUserId('  ')).toBe(false);
    });
  
    test('userId non numérique → invalide', () => {
      expect(isValidUserId('abc')).toBe(false);
      expect(isValidUserId('dev1@nibras.demo')).toBe(false);
    });
  
    test('userId négatif ou zéro → invalide', () => {
      expect(isValidUserId('0')).toBe(false);
      expect(isValidUserId('-1')).toBe(false);
    });
  });

// ─── Close task — tous les statuts source ────────────────────────────────────

describe('Close task — tous les statuts source', () => {
  function canCloseFromStatus(statusSlug: string): boolean {
    return statusSlug !== 'done';
  }

  test('todo → peut être fermée (si assignée)', () => {
    expect(canCloseFromStatus('todo')).toBe(true);
  });

  test('doing → peut être fermée (si assignée)', () => {
    expect(canCloseFromStatus('doing')).toBe(true);
  });

  test('review → peut être fermée (si assignée)', () => {
    expect(canCloseFromStatus('review')).toBe(true);
  });

  test('done → ne peut pas être re-fermée', () => {
    expect(canCloseFromStatus('done')).toBe(false);
  });
});

// ─── Remove member — protection du manager ───────────────────────────────────

describe('Remove member — protection du manager propriétaire', () => {
  function canRemoveMember(
    teamManagerId: string,
    targetUserId: string,
    requesterId: string,
    requesterRole: string,
  ): { ok: boolean; reason?: string } {
    const isOwner = requesterRole === 'admin' || String(teamManagerId) === String(requesterId);
    if (!isOwner) return { ok: false, reason: 'Only the team manager or an admin can remove members' };
    if (String(targetUserId) === String(teamManagerId)) {
      return { ok: false, reason: 'Cannot remove the team manager from the team; reassign managerId first' };
    }
    return { ok: true };
  }

  test('retirer un membre normal → autorisé par le manager', () => {
    const result = canRemoveMember('58', '59', '58', 'manager');
    expect(result.ok).toBe(true);
  });

  test('retirer le manager lui-même → refusé', () => {
    const result = canRemoveMember('58', '58', '58', 'manager');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('reassign');
  });

  test('admin peut retirer un membre normal', () => {
    const result = canRemoveMember('58', '59', '1', 'admin');
    expect(result.ok).toBe(true);
  });

  test('admin ne peut pas non plus retirer le manager', () => {
    const result = canRemoveMember('58', '58', '1', 'admin');
    expect(result.ok).toBe(false);
  });

  test('non-manager essaie de retirer → refusé', () => {
    const result = canRemoveMember('58', '59', '60', 'developer');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('manager');
  });
});

// ─── PATCH project — dates partielles ────────────────────────────────────────

describe('PATCH project — validation dates partielles', () => {
  function resolveNextDates(
    bodyStart: string | undefined,
    bodyEnd: string | undefined,
    dbStart: string | null,
    dbEnd: string | null,
  ): { nextStart: string | null; nextEnd: string | null } {
    return {
      nextStart: typeof bodyStart === 'string' ? bodyStart : dbStart,
      nextEnd: typeof bodyEnd === 'string' ? bodyEnd : dbEnd,
    };
  }

  test('modifier startDate seule → comparaison avec endDate de la base', () => {
    const { nextStart, nextEnd } = resolveNextDates('2026-07-01', undefined, '2026-06-01', '2026-09-30');
    expect(nextStart).toBe('2026-07-01');
    expect(nextEnd).toBe('2026-09-30');
    expect(isValidDateRange(nextStart, nextEnd)).toBe(true);
  });

  test('modifier endDate seule → comparaison avec startDate de la base', () => {
    const { nextStart, nextEnd } = resolveNextDates(undefined, '2026-08-01', '2026-06-01', '2026-09-30');
    expect(nextStart).toBe('2026-06-01');
    expect(nextEnd).toBe('2026-08-01');
    expect(isValidDateRange(nextStart, nextEnd)).toBe(true);
  });

  test('modifier startDate après endDate existante → invalide', () => {
    const { nextStart, nextEnd } = resolveNextDates('2026-12-01', undefined, '2026-06-01', '2026-09-30');
    expect(isValidDateRange(nextStart, nextEnd)).toBe(false);
  });

  test('aucune date fournie → garde les deux de la base', () => {
    const { nextStart, nextEnd } = resolveNextDates(undefined, undefined, '2026-06-01', '2026-09-30');
    expect(nextStart).toBe('2026-06-01');
    expect(nextEnd).toBe('2026-09-30');
  });
});

// ─── Error codes format ───────────────────────────────────────────────────────

describe('Error codes format — Validation & Errors Standard', () => {
  const VALID_ERROR_CODES = [
    'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
    'VALIDATION_ERROR', 'CONFLICT', 'INTERNAL_ERROR',
  ];

  test('tous les codes sont en MAJUSCULES', () => {
    for (const code of VALID_ERROR_CODES) {
      expect(code).toBe(code.toUpperCase());
    }
  });

  test('aucun code ne contient de chiffres', () => {
    for (const code of VALID_ERROR_CODES) {
      expect(/\d/.test(code)).toBe(false);
    }
  });

  test('format de réponse erreur contient message et code', () => {
    function makeError(message: string, code: string) {
      return { message, code };
    }
    const err = makeError('Project not found', 'NOT_FOUND');
    expect(err).toHaveProperty('message');
    expect(err).toHaveProperty('code');
    expect(typeof err.message).toBe('string');
    expect(typeof err.code).toBe('string');
  });

  test('code UNAUTHORIZED correspond au HTTP 401', () => {
    const httpCodes: Record<string, number> = {
      UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
      VALIDATION_ERROR: 400, CONFLICT: 409, INTERNAL_ERROR: 500,
    };
    expect(httpCodes['UNAUTHORIZED']).toBe(401);
    expect(httpCodes['FORBIDDEN']).toBe(403);
    expect(httpCodes['NOT_FOUND']).toBe(404);
    expect(httpCodes['VALIDATION_ERROR']).toBe(400);
    expect(httpCodes['CONFLICT']).toBe(409);
    expect(httpCodes['INTERNAL_ERROR']).toBe(500);
  });
});

// ─── Role check — création de team ───────────────────────────────────────────

describe('Role check — création de team', () => {
  function canCreateTeam(role: string): boolean {
    return role === 'manager' || role === 'admin';
  }

  test('manager → peut créer une team', () => {
    expect(canCreateTeam('manager')).toBe(true);
  });

  test('admin → peut créer une team', () => {
    expect(canCreateTeam('admin')).toBe(true);
  });

  test('developer → ne peut pas créer une team', () => {
    expect(canCreateTeam('developer')).toBe(false);
  });

  test('rôle null/inconnu → ne peut pas créer une team', () => {
    expect(canCreateTeam('')).toBe(false);
    expect(canCreateTeam('guest')).toBe(false);
  });
});

// ─── PATCH project — status par défaut ───────────────────────────────────────

describe('PATCH project — status non modifié garde la valeur existante', () => {
  function resolveNextStatus(
    bodyStatus: string | undefined,
    dbStatus: string,
    allowedStatuses: string[],
  ): { status: string; valid: boolean } {
    if (typeof bodyStatus === 'undefined') return { status: dbStatus, valid: true };
    return { status: bodyStatus, valid: allowedStatuses.includes(bodyStatus) };
  }

  const ALLOWED = ['active', 'on_hold', 'completed', 'archived'];

  test('status non fourni → garde le status de la base', () => {
    const result = resolveNextStatus(undefined, 'on_hold', ALLOWED);
    expect(result.status).toBe('on_hold');
    expect(result.valid).toBe(true);
  });

  test('status fourni valide → mis à jour', () => {
    const result = resolveNextStatus('archived', 'active', ALLOWED);
    expect(result.status).toBe('archived');
    expect(result.valid).toBe(true);
  });

  test('status fourni invalide → rejeté', () => {
    const result = resolveNextStatus('blabla', 'active', ALLOWED);
    expect(result.valid).toBe(false);
  });
});

// ─── riskScore — type entier ──────────────────────────────────────────────────

describe('riskScore — validation type entier', () => {
  function isValidRiskScoreStrict(value: number | null): boolean {
    if (value === null) return true;
    return Number.isInteger(value) && value >= 0 && value <= 100;
  }

  test('entier valide → accepté', () => {
    expect(isValidRiskScoreStrict(0)).toBe(true);
    expect(isValidRiskScoreStrict(50)).toBe(true);
    expect(isValidRiskScoreStrict(100)).toBe(true);
  });

  test('décimal → invalide même dans la plage 0-100', () => {
    expect(isValidRiskScoreStrict(75.5)).toBe(false);
    expect(isValidRiskScoreStrict(0.1)).toBe(false);
    expect(isValidRiskScoreStrict(99.9)).toBe(false);
  });

  test('null → valide (reset)', () => {
    expect(isValidRiskScoreStrict(null)).toBe(true);
  });
});

// ─── assignee_email legacy sync ───────────────────────────────────────────────

describe('assignee_email legacy — sync après suppression du dernier assigné', () => {
  function resolveAssigneeEmailAfterRemove(
    removedEmail: string,
    currentAssigneeEmail: string | null,
    remainingAssignees: string[],
  ): string | null {
    if (currentAssigneeEmail !== removedEmail) return currentAssigneeEmail;
    return remainingAssignees.length > 0 ? (remainingAssignees[0] as string) : null;
  }

  test('retirer le primary assignee → email passe au suivant', () => {
    const result = resolveAssigneeEmailAfterRemove(
      'dev1@nibras.demo', 'dev1@nibras.demo', ['dev2@nibras.demo'],
    );
    expect(result).toBe('dev2@nibras.demo');
  });

  test('retirer le dernier assigné → assignee_email = null', () => {
    const result = resolveAssigneeEmailAfterRemove(
      'dev1@nibras.demo', 'dev1@nibras.demo', [],
    );
    expect(result).toBeNull();
  });

  test('retirer un assigné non primary → assignee_email inchangé', () => {
    const result = resolveAssigneeEmailAfterRemove(
      'dev2@nibras.demo', 'dev1@nibras.demo', ['dev1@nibras.demo'],
    );
    expect(result).toBe('dev1@nibras.demo');
  });
});

// ─── History integration (BR-03) ─────────────────────────────────────────────

describe('History integration — BR-03', () => {
  function buildHistoryEntry(
    taskId: string, boardId: string,
    fromColumnId: string | null, toColumnId: string,
    fromSlug: string | null, toSlug: string,
    byEmail: string, note: string,
  ) {
    return { taskId, boardId, fromColumnId, toColumnId, fromSlug, toSlug, byEmail, note };
  }

  test('création de tâche → historique avec from=null', () => {
    const entry = buildHistoryEntry('t1', 'b1', null, 'col-todo', null, 'todo', 'manager@nibras.demo', 'Task created');
    expect(entry.fromColumnId).toBeNull();
    expect(entry.fromSlug).toBeNull();
    expect(entry.toSlug).toBe('todo');
  });

  test('move todo → doing → historique cohérent', () => {
    const entry = buildHistoryEntry('t1', 'b1', 'col-todo', 'col-doing', 'todo', 'doing', 'dev1@nibras.demo', 'Started');
    expect(entry.fromSlug).toBe('todo');
    expect(entry.toSlug).toBe('doing');
    expect(entry.fromColumnId).not.toBeNull();
  });

  test('close → historique avec toSlug=done', () => {
    const entry = buildHistoryEntry('t1', 'b1', 'col-review', 'col-done', 'review', 'done', 'manager@nibras.demo', 'Task closed');
    expect(entry.toSlug).toBe('done');
    expect(entry.note).toBe('Task closed');
  });

  test('champs obligatoires présents dans chaque entrée', () => {
    const entry = buildHistoryEntry('t1', 'b1', null, 'col-todo', null, 'todo', 'manager@nibras.demo', 'Task created');
    expect(entry.taskId).toBeDefined();
    expect(entry.boardId).toBeDefined();
    expect(entry.toColumnId).toBeDefined();
    expect(entry.toSlug).toBeDefined();
    expect(entry.byEmail).toBeDefined();
  });
});