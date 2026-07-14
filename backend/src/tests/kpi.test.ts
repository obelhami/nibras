/**
 * Module 6 — Unit tests : KPI Engine (src/lib/kpi.ts)
 *
 * Contrairement à business-rules.test.ts, ces fonctions sont pures et
 * exportées directement par lib/kpi.ts (pas de DB, pas de HTTP) : on importe
 * et on teste le VRAI code de production, pas une réimplémentation.
 *
 * Usage :
 *   bun test src/tests/kpi.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  computeOperationalKpis,
  computeFocusScore,
  computeTeamPulse,
  type KpiTaskRow,
  type KpiHistoryRow,
} from '../lib/kpi';

// ─── Helpers de fabrication de données ────────────────────────────────────────

function makeTask(overrides: Partial<KpiTaskRow> = {}): KpiTaskRow {
  return {
    id: 't1',
    status_slug: 'todo',
    due_date: null,
    complexity: null,
    assignee_email: null,
    created_at: '2026-06-01T08:00:00.000Z',
    updated_at: '2026-06-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeHistory(overrides: Partial<KpiHistoryRow> = {}): KpiHistoryRow {
  return {
    task_id: 't1',
    from_status_slug: null,
    to_status_slug: null,
    from_position: null,
    to_position: null,
    moved_by_email: 'dev@nibras.io',
    note: null,
    created_at: '2026-06-01T08:00:00.000Z',
    ...overrides,
  };
}

// ─── computeOperationalKpis — ADT ─────────────────────────────────────────────

describe('computeOperationalKpis — ADT (Average Delivery Time)', () => {
  test('aucune tâche terminée → ADT = 0', () => {
    const tasks = [makeTask({ id: 't1', status_slug: 'todo' })];
    const result = computeOperationalKpis(tasks, []);
    expect(result.adtHours).toBe(0);
    expect(result.adtDays).toBe(0);
  });

  test('une tâche créée puis "done" 24h après → ADT = 24h = 1 jour', () => {
    const tasks = [makeTask({ id: 't1', created_at: '2026-06-01T08:00:00.000Z' })];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'done', created_at: '2026-06-02T08:00:00.000Z' }),
    ];
    const result = computeOperationalKpis(tasks, history);
    expect(result.adtHours).toBe(24);
    expect(result.adtDays).toBe(1);
  });

  test('plusieurs tâches → ADT = moyenne des délais', () => {
    const tasks = [
      makeTask({ id: 't1', created_at: '2026-06-01T00:00:00.000Z' }),
      makeTask({ id: 't2', created_at: '2026-06-01T00:00:00.000Z' }),
    ];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'done', created_at: '2026-06-02T00:00:00.000Z' }), // 24h
      makeHistory({ task_id: 't2', to_status_slug: 'done', created_at: '2026-06-03T00:00:00.000Z' }), // 48h
    ];
    const result = computeOperationalKpis(tasks, history);
    expect(result.adtHours).toBe(36);
  });

  test('ne compte que le PREMIER passage à "done" (pas les réouvertures)', () => {
    const tasks = [makeTask({ id: 't1', created_at: '2026-06-01T00:00:00.000Z' })];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'done', created_at: '2026-06-02T00:00:00.000Z' }), // 24h → doit être retenu
      makeHistory({ task_id: 't1', to_status_slug: 'todo', created_at: '2026-06-03T00:00:00.000Z' }),
      makeHistory({ task_id: 't1', to_status_slug: 'done', created_at: '2026-06-10T00:00:00.000Z' }), // ignoré
    ];
    const result = computeOperationalKpis(tasks, history);
    expect(result.adtHours).toBe(24);
  });
});

// ─── computeOperationalKpis — VRR ─────────────────────────────────────────────

describe('computeOperationalKpis — VRR (Validation & Release Rate)', () => {
  test('2 tâches passées en review, 1 seule livrée → VRR = 50%', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'review' }),
      makeHistory({ task_id: 't1', to_status_slug: 'done' }),
      makeHistory({ task_id: 't2', to_status_slug: 'review' }),
    ];
    const result = computeOperationalKpis(tasks, history);
    expect(result.vrr).toBe(50);
  });

  test('aucune tâche n\'a atteint "review" → fallback done/total', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    const history = [makeHistory({ task_id: 't1', to_status_slug: 'done' })];
    const result = computeOperationalKpis(tasks, history);
    expect(result.vrr).toBe(50); // 1 done / 2 tasks
  });

  test('aucune tâche, aucun historique → VRR = 0', () => {
    const result = computeOperationalKpis([], []);
    expect(result.vrr).toBe(0);
  });

  test('toutes les tâches en review sont livrées → VRR = 100%', () => {
    const tasks = [makeTask({ id: 't1' })];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'review' }),
      makeHistory({ task_id: 't1', to_status_slug: 'done' }),
    ];
    const result = computeOperationalKpis(tasks, history);
    expect(result.vrr).toBe(100);
  });
});

// ─── computeOperationalKpis — ERR ─────────────────────────────────────────────

describe('computeOperationalKpis — ERR (Error Rate Ratio / rework)', () => {
  test('mouvement en arrière (position décroissante) → compté comme rework', () => {
    const history = [
      makeHistory({ task_id: 't1', from_position: 2, to_position: 0 }), // backward
      makeHistory({ task_id: 't1', from_position: 0, to_position: 1 }), // forward
    ];
    const result = computeOperationalKpis([], history);
    expect(result.err).toBe(50); // 1 backward / 2 total moves
  });

  test('lignes de création (from_position null) ignorées du calcul ERR', () => {
    const history = [
      makeHistory({ task_id: 't1', from_position: null, to_position: 0 }), // création, ignorée
      makeHistory({ task_id: 't1', from_position: 0, to_position: 2 }), // forward
    ];
    const result = computeOperationalKpis([], history);
    expect(result.err).toBe(0);
    expect(result.totals.totalMoves).toBe(1);
  });

  test('aucun mouvement réel → ERR = 0', () => {
    const result = computeOperationalKpis([], []);
    expect(result.err).toBe(0);
  });
});

// ─── computeOperationalKpis — Review Saturation ───────────────────────────────

describe('computeOperationalKpis — Review Saturation', () => {
  test('2 tâches actives dont 1 en review → saturation = 50%', () => {
    const tasks = [
      makeTask({ id: 't1', status_slug: 'review' }),
      makeTask({ id: 't2', status_slug: 'todo' }),
    ];
    const result = computeOperationalKpis(tasks, []);
    expect(result.reviewSaturation).toBe(50);
  });

  test('tâches "done" exclues du dénominateur (tâches actives)', () => {
    const tasks = [
      makeTask({ id: 't1', status_slug: 'review' }),
      makeTask({ id: 't2', status_slug: 'done' }),
    ];
    const result = computeOperationalKpis(tasks, []);
    // activeTasks = [t1] (t2 est done) → 1/1 = 100%
    expect(result.reviewSaturation).toBe(100);
  });

  test('aucune tâche active → saturation = 0 (pas de division par zéro)', () => {
    const tasks = [makeTask({ id: 't1', status_slug: 'done' })];
    const result = computeOperationalKpis(tasks, []);
    expect(result.reviewSaturation).toBe(0);
  });
});

// ─── computeFocusScore ─────────────────────────────────────────────────────────

describe('computeFocusScore — Focus Score (KPI-02)', () => {
  test('aucune activité, aucune tâche → score parfait de 100 ("excellent")', () => {
    const result = computeFocusScore('dev@nibras.io', [], [], 0);
    expect(result.score).toBe(100);
    expect(result.label).toBe('excellent');
  });

  test('changements de contexte fréquents (tâches différentes consécutives) → pénalité', () => {
    const moves = [
      makeHistory({ task_id: 't1' }),
      makeHistory({ task_id: 't2' }), // switch
      makeHistory({ task_id: 't3' }), // switch
    ];
    const result = computeFocusScore('dev@nibras.io', [], moves, 0);
    expect(result.indicators.contextSwitches).toBe(2);
    expect(result.score).toBe(100 - 2 * 3); // 94
  });

  test('mouvements consécutifs sur la MÊME tâche → pas de context switch', () => {
    const moves = [
      makeHistory({ task_id: 't1' }),
      makeHistory({ task_id: 't1' }),
      makeHistory({ task_id: 't1' }),
    ];
    const result = computeFocusScore('dev@nibras.io', [], moves, 0);
    expect(result.indicators.contextSwitches).toBe(0);
  });

  test('tâches non terminées → pénalité plafonnée à 30', () => {
    const assigned = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `t${i}`, status_slug: 'todo' }),
    );
    const result = computeFocusScore('dev@nibras.io', assigned, [], 0);
    expect(result.penalties.unfinishedPenalty).toBe(30); // plafond, pas 20*5=100
  });

  test('note contenant "block" (insensible à la casse) → détectée comme blocker', () => {
    const moves = [makeHistory({ task_id: 't1', note: 'Blocked by API dependency' })];
    const result = computeFocusScore('dev@nibras.io', [], moves, 0);
    expect(result.indicators.blockers).toBe(1);
  });

  test('score ne descend jamais sous 0 (clamp)', () => {
    const assigned = Array.from({ length: 50 }, (_, i) => makeTask({ id: `t${i}` }));
    const moves = Array.from({ length: 50 }, (_, i) =>
      makeHistory({ task_id: `t${i}`, note: 'blocker here' }),
    );
    const result = computeFocusScore('dev@nibras.io', assigned, moves, 50);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test('labels : excellent (>=80), good (>=60), fair (>=40), poor (<40)', () => {
    expect(computeFocusScore('a', [], [], 0).label).toBe('excellent'); // 100
    // 3 unfinished (15) + 4 reassignments (20) = -35 → 65 → good
    const assigned3 = [makeTask({ id: '1' }), makeTask({ id: '2' }), makeTask({ id: '3' })];
    expect(computeFocusScore('a', assigned3, [], 4).label).toBe('good');
  });
});

// ─── computeTeamPulse ──────────────────────────────────────────────────────────

describe('computeTeamPulse — Team Pulse (KPI-03)', () => {
  const NOW = new Date('2026-06-15T00:00:00.000Z').getTime();

  test('équipe sans tâches → healthy, score = 100', () => {
    const result = computeTeamPulse([], [], 3, 0, NOW);
    expect(result.state).toBe('healthy');
    expect(result.score).toBe(100);
  });

  test('workload > 5 tâches/membre → état "overloaded"', () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      makeTask({ id: `t${i}`, status_slug: 'todo' }),
    );
    const result = computeTeamPulse(tasks, [], 2, 0, NOW); // 6 tâches/membre
    expect(result.state).toBe('overloaded');
  });

  test('ratio de retard élevé (>40%) → état "critical" quel que soit le score', () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `t${i}`, status_slug: 'todo', due_date: '2026-01-01T00:00:00.000Z' }), // toutes en retard
    );
    const result = computeTeamPulse(tasks, [], 5, 0, NOW);
    expect(result.state).toBe('critical');
    expect(result.inputs.overdueRatio).toBe(100);
  });

  test('beaucoup de blockers (>=5) → état "unstable"', () => {
    const tasks = [makeTask({ id: 't1', status_slug: 'todo' })];
    const history = Array.from({ length: 6 }, (_, i) =>
      makeHistory({ task_id: 't1', note: 'blocked again' }),
    );
    const result = computeTeamPulse(tasks, history, 5, 0, NOW);
    expect(result.state).toBe('unstable');
  });

  test('livraison après due_date → comptée comme "delayed"', () => {
    const tasks = [
      makeTask({ id: 't1', created_at: '2026-06-01T00:00:00.000Z', due_date: '2026-06-05T00:00:00.000Z' }),
    ];
    const history = [
      makeHistory({ task_id: 't1', to_status_slug: 'done', created_at: '2026-06-10T00:00:00.000Z' }), // après due_date
    ];
    const result = computeTeamPulse(tasks, history, 3, 0, NOW);
    expect(result.inputs.delayedTasks).toBe(1);
    expect(result.inputs.completedTasks).toBe(1);
  });

  test('memberCount <= 0 → traité comme 1 (pas de division par zéro)', () => {
    const tasks = [makeTask({ id: 't1' })];
    const result = computeTeamPulse(tasks, [], 0, 0, NOW);
    expect(result.inputs.members).toBe(1);
  });
});