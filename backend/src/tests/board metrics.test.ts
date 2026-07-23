/**
 * Unit tests : recalculateBoardState (src/routes/board/metrics.ts)
 *
 * Mock du module `../../../db` pour tester le vrai calcul de métriques et de
 * signaux (unassigned_high_complexity, overdue, deadline_risk) sans DB réelle.
 *
 * Usage : bun test src/tests/board-metrics.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

type Row = Record<string, unknown>;

const fixtures: { board: Row | null; columns: Row[]; tasks: Row[] } = {
  board: null,
  columns: [],
  tasks: [],
};

const executeMock = mock(async ({ sql }: { sql: string; args: unknown[] }) => {
  if (sql.includes('FROM boards')) return { rows: fixtures.board ? [fixtures.board] : [] } as any;
  if (sql.includes('FROM board_columns WHERE board_id')) return { rows: fixtures.columns } as any;
  if (sql.includes('FROM tasks')) return { rows: fixtures.tasks } as any;
  return { rows: [] } as any; // DELETE / INSERT task_signals / board_metrics
});

mock.module('../../db', () => ({ db: { execute: executeMock } }));

const { recalculateBoardState } = await import('../routes/board/metrics');

beforeEach(() => {
  fixtures.board = null;
  fixtures.columns = [];
  fixtures.tasks = [];
  executeMock.mockClear();
});

function boardRow(overrides: Row = {}): Row {
  return {
    id: 'b1',
    title: 'Nibrasello board',
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

function taskRow(overrides: Row = {}): Row {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    board_id: 'b1',
    column_id: 'col-1',
    title: 'Task',
    description: null,
    priority: 'medium',
    status_slug: 'todo',
    due_date: null,
    complexity: null,
    assignee_email: null,
    assignee_id: null,
    created_by_email: 'dev@nibras.io',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    column_name: 'Todo',
    column_slug: 'todo',
    column_position: 0,
    ...overrides,
  };
}

describe('recalculateBoardState — board introuvable', () => {
  test('retourne null sans planter', async () => {
    fixtures.board = null;
    const result = await recalculateBoardState('ghost-board');
    expect(result).toBeNull();
  });
});

describe('recalculateBoardState — métriques globales', () => {
  test('board vide → toutes les métriques à 0', async () => {
    fixtures.board = boardRow();
    fixtures.columns = [];
    fixtures.tasks = [];
    const result = await recalculateBoardState('b1');
    expect(result?.metrics.totalTasks).toBe(0);
    expect(result?.metrics.completionRate).toBe(0);
    expect(result?.metrics.averageComplexity).toBe(0);
    expect(result?.signals).toEqual([]);
  });

  test('taux de complétion calculé correctement (2 done / 4 total = 50%)', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [
      taskRow({ status_slug: 'done' }),
      taskRow({ status_slug: 'done' }),
      taskRow({ status_slug: 'todo' }),
      taskRow({ status_slug: 'doing' }),
    ];
    const result = await recalculateBoardState('b1');
    expect(result?.metrics.totalTasks).toBe(4);
    expect(result?.metrics.doneTasks).toBe(2);
    expect(result?.metrics.completionRate).toBe(50);
  });

  test('complexité moyenne arrondie à 2 décimales, tâches sans complexité comptées comme 0', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [
      taskRow({ complexity: 3 }),
      taskRow({ complexity: 4 }),
      taskRow({ complexity: null }), // compté comme 0
    ];
    const result = await recalculateBoardState('b1');
    expect(result?.metrics.averageComplexity).toBe(2.33); // (3+4+0)/3
  });

  test('tâches sans assignee comptées dans unassignedTasks', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [
      taskRow({ assignee_email: null }),
      taskRow({ assignee_email: 'dev@nibras.io' }),
    ];
    const result = await recalculateBoardState('b1');
    expect(result?.metrics.unassignedTasks).toBe(1);
  });

  test('répartition par colonne (byColumn) reflète le nombre de tâches par colonne', async () => {
    fixtures.board = boardRow();
    fixtures.columns = [
      { id: 'col-todo', name: 'Todo', slug: 'todo', position: 0 },
      { id: 'col-done', name: 'Done', slug: 'done', position: 1 },
    ];
    fixtures.tasks = [
      taskRow({ column_id: 'col-todo' }),
      taskRow({ column_id: 'col-todo' }),
      taskRow({ column_id: 'col-done', status_slug: 'done' }),
    ];
    const result = await recalculateBoardState('b1');
    const byColumn = result?.metrics.byColumn as Array<{ id: string; taskCount: number }>;
    expect(byColumn.find((c) => c.id === 'col-todo')?.taskCount).toBe(2);
    expect(byColumn.find((c) => c.id === 'col-done')?.taskCount).toBe(1);
  });
});

describe('recalculateBoardState — signaux comportementaux (weak signals)', () => {
  test('tâche non-assignée + complexité >= 4 → signal "unassigned_high_complexity"', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [taskRow({ assignee_email: null, complexity: 4, title: 'Refonte auth' })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals).toHaveLength(1);
    expect(result?.signals[0]).toMatchObject({
      signalType: 'unassigned_high_complexity',
      severity: 'high',
    });
  });

  test('tâche non-assignée mais complexité < 4 → aucun signal', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [taskRow({ assignee_email: null, complexity: 2 })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals).toHaveLength(0);
  });

  test('tâche en retard (due_date passée, pas "done") → signal "overdue" critique', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [taskRow({ due_date: '2020-01-01T00:00:00.000Z', status_slug: 'doing' })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals.some((s) => s.signalType === 'overdue' && s.severity === 'critical')).toBe(true);
  });

  test('tâche "done" en retard → PAS de signal overdue (livrée, peu importe la date)', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [taskRow({ due_date: '2020-01-01T00:00:00.000Z', status_slug: 'done' })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals).toHaveLength(0);
  });

  test('échéance proche (<=2 jours, pas encore dépassée) → signal "deadline_risk" moyen', async () => {
    fixtures.board = boardRow();
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(); // dans 1 jour
    fixtures.tasks = [taskRow({ due_date: soon, status_slug: 'todo' })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals.some((s) => s.signalType === 'deadline_risk' && s.severity === 'medium')).toBe(true);
  });

  test('échéance lointaine (>2 jours) → aucun signal de délai', async () => {
    fixtures.board = boardRow();
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    fixtures.tasks = [taskRow({ due_date: farFuture, status_slug: 'todo' })];
    const result = await recalculateBoardState('b1');
    expect(result?.signals).toHaveLength(0);
  });

  test('persiste les signaux : DELETE puis INSERT dans task_signals, puis upsert board_metrics', async () => {
    fixtures.board = boardRow();
    fixtures.tasks = [taskRow({ complexity: 5, assignee_email: null })];
    await recalculateBoardState('b1');

    const calls = executeMock.mock.calls.map(([q]: any) => q.sql as string);
    expect(calls.some((sql) => sql.includes('DELETE FROM task_signals'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO task_signals'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO board_metrics'))).toBe(true);
  });
});