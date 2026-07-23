/**
 * Module 4 — Unit tests : src/routes/board/shared.ts
 *
 * Partie 1 : utilitaires purs (slugifyColumnName, normalizeText) → import
 * direct, aucun mock nécessaire.
 * Partie 2 : contrôle d'accès (getAccessibleBoard / getManageableBoard) →
 * `../../../db` mocké, mêmes fonctions réellement exécutées.
 *
 * Usage : bun test src/tests/board-shared.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { slugifyColumnName, normalizeText } from '../routes/board/shared';

// ─── slugifyColumnName (pur) ───────────────────────────────────────────────────

describe('slugifyColumnName', () => {
  test('minuscule et remplace les espaces par des tirets', () => {
    expect(slugifyColumnName('In Review')).toBe('in-review');
  });

  test('retire les caractères spéciaux', () => {
    expect(slugifyColumnName('Todo !!! (v2)')).toBe('todo-v2');
  });

  test('retire les tirets en début/fin de chaîne', () => {
    expect(slugifyColumnName('--Doing--')).toBe('doing');
  });

  test('chaîne vide ou uniquement des symboles → fallback "column"', () => {
    expect(slugifyColumnName('')).toBe('column');
    expect(slugifyColumnName('!!!')).toBe('column');
  });

  test('espaces multiples consécutifs → un seul tiret', () => {
    expect(slugifyColumnName('Code   Review')).toBe('code-review');
  });
});

// ─── normalizeText (pur) ────────────────────────────────────────────────────────

describe('normalizeText (board/shared.ts)', () => {
  test('trim une chaîne', () => {
    expect(normalizeText('  Board title  ')).toBe('Board title');
  });

  test('valeur non-string → chaîne vide', () => {
    expect(normalizeText(42)).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

// ─── Contrôle d'accès (avec mock DB) ──────────────────────────────────────────

type Row = Record<string, unknown>;

const fixtures: { board: Row | null; teamMembership: boolean; isTeamManager: boolean } = {
  board: null,
  teamMembership: false,
  isTeamManager: false,
};

const executeMock = mock(async ({ sql }: { sql: string; args: unknown[] }) => {
  if (sql.includes('FROM boards')) {
    return { rows: fixtures.board ? [fixtures.board] : [] } as any;
  }
  // BR-07 : un manager n'est autorisé que s'il est teams.manager_id de l'équipe du board.
  if (sql.includes('FROM teams WHERE id')) {
    return { rows: fixtures.isTeamManager ? [{ 1: 1 }] : [] } as any;
  }
  if (sql.includes('FROM team_members WHERE team_id')) {
    return { rows: fixtures.teamMembership ? [{ 1: 1 }] : [] } as any;
  }
  return { rows: [] } as any;
});

mock.module('../../db', () => ({ db: { execute: executeMock } }));

const { getAccessibleBoard, getManageableBoard } = await import('../routes/board/shared');

beforeEach(() => {
  fixtures.board = null;
  fixtures.teamMembership = false;
  fixtures.isTeamManager = false;
  executeMock.mockClear();
});

function board(overrides: Row = {}): Row {
  return {
    id: 'b1',
    title: 'Sprint board',
    source: 'nibrasello',
    linked_project: null,
    linked_project_name: null,
    visibility: 'private',
    team_id: 'team-1',
    owner_email: 'owner@nibras.io',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

const OWNER = { id: '1', email: 'owner@nibras.io', username: 'owner', role: 'developer' };
const OTHER_DEV = { id: '2', email: 'other@nibras.io', username: 'other', role: 'developer' };
const MANAGER = { id: '3', email: 'mgr@nibras.io', username: 'mgr', role: 'manager' };
const ADMIN = { id: '4', email: 'admin@nibras.io', username: 'admin', role: 'admin' };

describe('getAccessibleBoard — lecture (BR-06/BR-07)', () => {
  test('board introuvable → 404', async () => {
    fixtures.board = null;
    const result = await getAccessibleBoard('missing', OWNER as any);
    expect(result).toEqual({ error: 'Board not found', status: 404 });
  });

  test('le propriétaire du board a toujours accès', async () => {
    fixtures.board = board();
    const result = await getAccessibleBoard('b1', OWNER as any);
    expect('board' in result).toBe(true);
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board (teams.manager_id) → accès autorisé', async () => {
    fixtures.board = board({ visibility: 'private', team_id: 'team-1' });
    fixtures.isTeamManager = true;
    const result = await getAccessibleBoard('b1', MANAGER as any);
    expect('board' in result).toBe(true);
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe du board → 403 Forbidden (fini l\'accès illimité)', async () => {
    fixtures.board = board({ visibility: 'private', team_id: 'team-1' });
    fixtures.isTeamManager = false;
    const result = await getAccessibleBoard('b1', MANAGER as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });

  test('admin a accès à tout, même hors de son périmètre', async () => {
    fixtures.board = board({ visibility: 'private' });
    const result = await getAccessibleBoard('b1', ADMIN as any);
    expect('board' in result).toBe(true);
  });

  test('board public → accessible par n\'importe quel développeur', async () => {
    fixtures.board = board({ visibility: 'public', owner_email: 'someone-else@nibras.io' });
    const result = await getAccessibleBoard('b1', OTHER_DEV as any);
    expect('board' in result).toBe(true);
  });

  test('board privé + développeur hors équipe → 403 Forbidden', async () => {
    fixtures.board = board({ visibility: 'private' });
    fixtures.teamMembership = false;
    const result = await getAccessibleBoard('b1', OTHER_DEV as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });

  test('board privé + développeur MEMBRE de l\'équipe → accès autorisé', async () => {
    fixtures.board = board({ visibility: 'private', team_id: 'team-1' });
    fixtures.teamMembership = true;
    const result = await getAccessibleBoard('b1', OTHER_DEV as any);
    expect('board' in result).toBe(true);
  });

  test('board sans équipe (team_id null) + développeur externe → 403', async () => {
    fixtures.board = board({ visibility: 'private', team_id: null });
    const result = await getAccessibleBoard('b1', OTHER_DEV as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });

  test('BR-07 : board sans équipe (team_id null) + manager non-propriétaire → 403 (rien à diriger)', async () => {
    fixtures.board = board({ visibility: 'private', team_id: null });
    fixtures.isTeamManager = false;
    const result = await getAccessibleBoard('b1', MANAGER as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });
});

describe('getManageableBoard — écriture (création/édition colonnes, tâches)', () => {
  test('board introuvable → 404', async () => {
    fixtures.board = null;
    const result = await getManageableBoard('missing', MANAGER as any);
    expect(result).toEqual({ error: 'Board not found', status: 404 });
  });

  test('propriétaire du board peut toujours le gérer, même s\'il est developer', async () => {
    fixtures.board = board({ owner_email: OWNER.email });
    const result = await getManageableBoard('b1', OWNER as any);
    expect('board' in result).toBe(true);
  });

  test('developer non-propriétaire ne peut pas gérer un board (create_board refusé)', async () => {
    fixtures.board = board({ owner_email: 'someone-else@nibras.io' });
    const result = await getManageableBoard('b1', OTHER_DEV as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });

  test('BR-07 : manager qui DIRIGE l\'équipe du board → peut le gérer', async () => {
    fixtures.board = board({ owner_email: 'someone-else@nibras.io', team_id: 'team-1' });
    fixtures.isTeamManager = true;
    const result = await getManageableBoard('b1', MANAGER as any);
    expect('board' in result).toBe(true);
  });

  test('BR-07 : manager qui NE dirige PAS l\'équipe du board → 403 (fini le "manager gère tout")', async () => {
    fixtures.board = board({ owner_email: 'someone-else@nibras.io', team_id: 'team-1' });
    fixtures.isTeamManager = false;
    const result = await getManageableBoard('b1', MANAGER as any);
    expect(result).toEqual({ error: 'Forbidden', status: 403 });
  });

  test('admin non-propriétaire peut toujours gérer n\'importe quel board', async () => {
    fixtures.board = board({ owner_email: 'someone-else@nibras.io' });
    const result = await getManageableBoard('b1', ADMIN as any);
    expect('board' in result).toBe(true);
  });
});