/**
 * Module 7 — Unit tests : Behavioral Engine (src/lib/behavior.ts)
 *
 * behavior.ts appelle directement `db.execute` (Turso). On mock le module
 * `../../db` AVANT de l'importer, pour tester les vraies fonctions exportées
 * (detectSilentOverload, detectReviewSaturation, analyzeContributionStyle)
 * sans jamais toucher une vraie base de données.
 *
 * IMPORTANT : les scénarios "silent overload" et "review saturation" ont été
 * calculés à la main pour tomber pile sur les seuils de src/lib/behavior.ts
 * (voir commentaires). Le scénario "contribution style" reste volontairement
 * moins strict : les 7 styles se chevauchent par design (cf. spec V1.1,
 * section 15), donc on teste le contrat (style valide + confiance bornée)
 * plutôt qu'un style exact.
 *
 * Usage : bun test src/tests/behavior.test.ts
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ─── Mock de la DB ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const fixtures: {
  user: Row[];
  assignedTasks: Row[];
  historyByTaskIds: Row[];
  activityHistory: Row[];
  reviewTasksForProject: Row[];
} = {
  user: [],
  assignedTasks: [],
  historyByTaskIds: [],
  activityHistory: [],
  reviewTasksForProject: [],
};

const executeMock = mock(async ({ sql }: { sql: string; args: unknown[] }) => {
  if (sql.includes('FROM users WHERE id')) return { rows: fixtures.user } as any;
  if (sql.includes('tasks.assignee_email = ?')) return { rows: fixtures.assignedTasks } as any;
  if (sql.includes('task_id IN')) return { rows: fixtures.historyByTaskIds } as any;
  if (sql.includes('moved_by_email = ?') && sql.includes("datetime('now'"))
    return { rows: fixtures.activityHistory } as any;
  if (sql.includes('boards.linked_project = ?')) return { rows: fixtures.reviewTasksForProject } as any;
  return { rows: [] } as any;
});

mock.module('../../db', () => ({ db: { execute: executeMock } }));

const { detectSilentOverload, detectReviewSaturation, analyzeContributionStyle } = await import(
  '../lib/behavior'
);

beforeEach(() => {
  fixtures.user = [];
  fixtures.assignedTasks = [];
  fixtures.historyByTaskIds = [];
  fixtures.activityHistory = [];
  fixtures.reviewTasksForProject = [];
  executeMock.mockClear();
});

// ─── Fixtures helpers ───────────────────────────────────────────────────────────

const USER = { id: 1, email: 'dev@nibras.io', username: 'dev', role: 'developer' };

function task(overrides: Row = {}): Row {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    board_id: 'b1',
    column_id: 'c1',
    title: 'Task',
    description: null,
    priority: 'normal',
    status_slug: 'todo',
    due_date: null,
    complexity: null,
    assignee_email: USER.email,
    created_by_email: USER.email,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    board_title: 'Board',
    board_linked_project: 'p1',
    column_slug: 'todo',
    column_name: 'Todo',
    ...overrides,
  };
}

// ─── detectSilentOverload — BEHAV-01 ──────────────────────────────────────────

describe('detectSilentOverload', () => {
  test('utilisateur introuvable → confidence 0, aucun signal', async () => {
    fixtures.user = [];
    const result = await detectSilentOverload('999');
    expect(result).toEqual({ confidence: 0 });
  });

  test('faible charge, aucun retard, aucune activité → confidence 0, aucun signal', async () => {
    fixtures.user = [USER];
    fixtures.assignedTasks = [task(), task()]; // 2 tâches, pas de retard
    fixtures.activityHistory = [];
    fixtures.historyByTaskIds = [];
    const result = await detectSilentOverload('1');
    expect(result.confidence).toBe(0);
    expect(result.signal).toBeUndefined();
  });

  test('surcharge invisible avérée (25 tâches, 13 en retard, 6 en review bloquées, activité instable et nocturne) → signal détecté', async () => {
    fixtures.user = [USER];

    const overdueTasks = Array.from({ length: 13 }, () =>
      task({ status_slug: 'todo', due_date: '2020-06-01T00:00:00.000Z' }), // largement dépassé
    );
    const reviewTasks = Array.from({ length: 6 }, () =>
      task({ status_slug: 'review', updated_at: '2020-01-01T00:00:00.000Z' }), // bloquées depuis des années
    );
    const fillerTasks = Array.from({ length: 6 }, () => task({ status_slug: 'todo' }));
    fixtures.assignedTasks = [...overdueTasks, ...reviewTasks, ...fillerTasks]; // total = 25

    // Pas d'entrée d'historique pour les tâches en review → fallback sur updated_at (vieux) → toujours "bloqué"
    fixtures.historyByTaskIds = [];

    // 8 événements d'activité avec un grand écart (>4 jours) → pattern jugé instable,
    // dont la moitié la nuit (heure UTC >= 22 ou <= 5) → lateNightRatio = 0.5
    fixtures.activityHistory = [
      { task_id: 't1', board_id: 'b1', from_status_slug: null, to_status_slug: 'doing', moved_by_email: USER.email, note: null, created_at: '2020-01-01T23:00:00.000Z' },
      { task_id: 't1', board_id: 'b1', from_status_slug: 'doing', to_status_slug: 'review', moved_by_email: USER.email, note: null, created_at: '2020-01-02T23:00:00.000Z' },
      { task_id: 't2', board_id: 'b1', from_status_slug: null, to_status_slug: 'doing', moved_by_email: USER.email, note: null, created_at: '2020-01-20T10:00:00.000Z' }, // gros écart avec la ligne précédente
      { task_id: 't2', board_id: 'b1', from_status_slug: 'doing', to_status_slug: 'review', moved_by_email: USER.email, note: null, created_at: '2020-01-21T10:00:00.000Z' },
      { task_id: 't3', board_id: 'b1', from_status_slug: null, to_status_slug: 'doing', moved_by_email: USER.email, note: null, created_at: '2020-01-22T02:00:00.000Z' },
      { task_id: 't3', board_id: 'b1', from_status_slug: 'doing', to_status_slug: 'review', moved_by_email: USER.email, note: null, created_at: '2020-01-23T02:00:00.000Z' },
      { task_id: 't4', board_id: 'b1', from_status_slug: null, to_status_slug: 'doing', moved_by_email: USER.email, note: null, created_at: '2020-01-24T10:00:00.000Z' },
      { task_id: 't4', board_id: 'b1', from_status_slug: 'doing', to_status_slug: 'review', moved_by_email: USER.email, note: null, created_at: '2020-01-25T10:00:00.000Z' },
    ];

    const result = await detectSilentOverload('1');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signal).toBe('silent_overload');
  });
});

// ─── detectReviewSaturation — BEHAV-02 ────────────────────────────────────────

describe('detectReviewSaturation', () => {
  test('aucune tâche en review sur le projet → confidence 0, aucun signal', async () => {
    fixtures.reviewTasksForProject = [];
    const result = await detectReviewSaturation('p1');
    expect(result).toEqual({ confidence: 0 });
  });

  test('file de review massivement saturée et bloquée → signal détecté', async () => {
    // 20 tâches en review, toutes "vieilles" (updated_at très ancien, pas d'entrée
    // d'historique donc fallback sur updated_at) → temps d'attente très largement
    // au-dessus du seuil de blocage (reviewStallDays = 3).
    fixtures.reviewTasksForProject = Array.from({ length: 20 }, () =>
      task({ status_slug: 'review', updated_at: '2020-01-01T00:00:00.000Z' }),
    );
    fixtures.historyByTaskIds = []; // pas de mouvement enregistré → fallback updated_at

    const result = await detectReviewSaturation('p1');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signal).toBe('review_saturation');
  });

  test('quelques tâches en review, sous le seuil de backlog → pas de signal', async () => {
    fixtures.reviewTasksForProject = [
      task({ status_slug: 'review', updated_at: new Date().toISOString() }),
      task({ status_slug: 'review', updated_at: new Date().toISOString() }),
    ];
    fixtures.historyByTaskIds = [];
    const result = await detectReviewSaturation('p1');
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.signal).toBeUndefined();
  });
});

// ─── analyzeContributionStyle — BEHAV-03 ──────────────────────────────────────

const VALID_STYLES = [
    'stabilizer',
    'accelerator',
    'firefighter',
    'silent_architect',
    'team_support',
    'debt_generator',
    'critical_problem_solver',
    'system_protector',
  ];

describe('analyzeContributionStyle — contrat général', () => {
  test('utilisateur introuvable → style par défaut "stabilizer", confidence 0', async () => {
    fixtures.user = [];
    const result = await analyzeContributionStyle('999');
    expect(result).toEqual({ style: 'stabilizer', confidence: 0 });
  });

  test('aucune tâche assignée → renvoie un style valide avec une confiance bornée entre 0 et 1', async () => {
    fixtures.user = [USER];
    fixtures.assignedTasks = [];
    fixtures.historyByTaskIds = [];
    const result = await analyzeContributionStyle('1');
    expect(VALID_STYLES).toContain(result.style);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test('beaucoup de tâches critiques/urgentes livrées vite → ne doit PAS être classé "team_support" ni "debt_generator"', async () => {
    fixtures.user = [USER];
    fixtures.assignedTasks = Array.from({ length: 15 }, (_, i) =>
      task({
        id: `crit-${i}`,
        title: 'Critical production outage hotfix',
        priority: 'urgent',
        status_slug: 'done',
        complexity: 5,
        created_at: '2026-01-01T00:00:00.000Z',
      }),
    );
    fixtures.historyByTaskIds = fixtures.assignedTasks.map((t) => ({
      task_id: (t as Row).id,
      board_id: 'b1',
      from_status_slug: 'doing',
      to_status_slug: 'done',
      moved_by_email: USER.email,
      note: null,
      created_at: '2026-01-01T02:00:00.000Z', // livré très vite, jamais réouvert
    }));
    const result = await analyzeContributionStyle('1');
    expect(VALID_STYLES).toContain(result.style);
    expect(result.style).not.toBe('team_support');
    expect(result.style).not.toBe('debt_generator');
  });

  test('n\'appelle jamais getProjectReviewTasks (hors scope de cette fonction)', async () => {
    fixtures.user = [USER];
    fixtures.assignedTasks = [task()];
    await analyzeContributionStyle('1');
    // Note : la requête de getAssignedTasksByEmail sélectionne elle-même une
    // colonne "boards.linked_project AS board_linked_project", donc on cible
    // ici la clause WHERE propre à getProjectReviewTasks pour éviter le faux
    // positif (une simple recherche de "boards.linked_project" matcherait
    // aussi le nom de colonne dans une requête légitime et différente).
    const calledProjectReview = executeMock.mock.calls.some(([q]: any) =>
      q.sql.includes('WHERE boards.linked_project = ?'),
    );
    expect(calledProjectReview).toBe(false);
  });
});