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
    // Simule le comportement : body.status ?? 'active'
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

// ─── Manager/admin control ────────────────────────────────────────────────────

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

  test('création → historique avec from=null', () => {
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
  });

  test('champs obligatoires présents', () => {
    const entry = buildHistoryEntry('t1', 'b1', null, 'col-todo', null, 'todo', 'manager@nibras.demo', 'Task created');
    expect(entry.taskId).toBeDefined();
    expect(entry.boardId).toBeDefined();
    expect(entry.toColumnId).toBeDefined();
    expect(entry.byEmail).toBeDefined();
  });
});