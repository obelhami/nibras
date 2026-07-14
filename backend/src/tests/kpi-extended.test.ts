/**
 * Unit tests for the CDC-compliance additions (Modules 1, 2, 6, 7).
 * Pure business logic only — no DB, no HTTP, no JWT.
 *
 * Usage:
 *   bun test src/tests/kpi-extended.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  computeCRT,
  computeADR,
  computePRR,
  computeSLI,
  computeEmotionalKpis,
  type KpiHistoryRow,
  type KpiTaskRow,
  type KpiCommentRow,
  type ProactiveTaskRow,
} from '../lib/kpi';
import { hasPermission, getPermissions } from '../lib/permissions';

function historyRow(overrides: Partial<KpiHistoryRow>): KpiHistoryRow {
  return {
    task_id: 't1',
    from_status_slug: null,
    to_status_slug: null,
    from_position: null,
    to_position: null,
    moved_by_email: 'dev@nibras.dev',
    note: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function taskRow(overrides: Partial<ProactiveTaskRow>): ProactiveTaskRow {
  return {
    id: 't1',
    status_slug: 'todo',
    due_date: null,
    complexity: null,
    assignee_email: 'dev@nibras.dev',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_proactive: null,
    ...overrides,
  };
}

// ─── CRT — Client Response Time ────────────────────────────────────────────

describe('KPI-06 — CRT (Client Response Time)', () => {
  test('tâche jamais entrée en review → CRT = 0', () => {
    const history = [historyRow({ task_id: 't1', to_status_slug: 'doing', created_at: '2026-01-01T00:00:00Z' })];
    expect(computeCRT(history)).toBe(0);
  });

  test('review → done après 10h → CRT = 10', () => {
    const history = [
      historyRow({ task_id: 't1', to_status_slug: 'review', created_at: '2026-01-01T00:00:00Z' }),
      historyRow({ task_id: 't1', to_status_slug: 'done', created_at: '2026-01-01T10:00:00Z' }),
    ];
    expect(computeCRT(history)).toBe(10);
  });

  test('toujours en review → utilise "now" comme borne', () => {
    const enteredAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const history = [historyRow({ task_id: 't1', to_status_slug: 'review', created_at: enteredAt })];
    const crt = computeCRT(history);
    expect(crt).toBeGreaterThan(4.5);
    expect(crt).toBeLessThan(5.5);
  });
});

// ─── ADR — Active Documentation Ratio ──────────────────────────────────────

describe('KPI-06 — ADR (Active Documentation Ratio)', () => {
  test('aucune tâche terminée → ADR = 0', () => {
    expect(computeADR([], [])).toBe(0);
  });

  test('2 tâches done, 1 commentée → ADR = 50%', () => {
    const history = [
      historyRow({ task_id: 't1', to_status_slug: 'done' }),
      historyRow({ task_id: 't2', to_status_slug: 'done' }),
    ];
    const comments: KpiCommentRow[] = [{ task_id: 't1', created_at: new Date().toISOString() }];
    expect(computeADR(history, comments)).toBe(50);
  });

  test('toutes les tâches done documentées → ADR = 100%', () => {
    const history = [historyRow({ task_id: 't1', to_status_slug: 'done' })];
    const comments: KpiCommentRow[] = [{ task_id: 't1', created_at: new Date().toISOString() }];
    expect(computeADR(history, comments)).toBe(100);
  });
});

// ─── PRR — Proactive Recommendation Rate ───────────────────────────────────

describe('KPI-06 — PRR (Proactive Recommendation Rate)', () => {
  test('aucune tâche → PRR = 0', () => {
    expect(computePRR([])).toBe(0);
  });

  test('1 tâche proactive sur 4 → PRR = 25%', () => {
    const tasks: ProactiveTaskRow[] = [
      taskRow({ id: 't1', is_proactive: 1 }),
      taskRow({ id: 't2', is_proactive: 0 }),
      taskRow({ id: 't3', is_proactive: false }),
      taskRow({ id: 't4', is_proactive: null }),
    ];
    expect(computePRR(tasks)).toBe(25);
  });

  test('accepte is_proactive en boolean ou en 0/1', () => {
    const tasks: ProactiveTaskRow[] = [
      taskRow({ id: 't1', is_proactive: true }),
      taskRow({ id: 't2', is_proactive: 1 }),
    ];
    expect(computePRR(tasks)).toBe(100);
  });
});

// ─── SLI — Self Learning Index ─────────────────────────────────────────────

describe('KPI-06 — SLI (Self Learning Index)', () => {
  test('moins de 4 tâches terminées → score neutre, lowConfidence', () => {
    const result = computeSLI([
      { taskId: 't1', createdAt: '2026-01-01T00:00:00Z', doneAt: '2026-01-02T00:00:00Z' },
    ]);
    expect(result.score).toBe(50);
    expect(result.lowConfidence).toBe(true);
  });

  test('cycle time qui diminue dans le temps → score > 50', () => {
    const result = computeSLI([
      { taskId: 't1', createdAt: '2026-01-01T00:00:00Z', doneAt: '2026-01-03T00:00:00Z' }, // 48h
      { taskId: 't2', createdAt: '2026-01-04T00:00:00Z', doneAt: '2026-01-06T00:00:00Z' }, // 48h
      { taskId: 't3', createdAt: '2026-01-07T00:00:00Z', doneAt: '2026-01-07T06:00:00Z' }, // 6h
      { taskId: 't4', createdAt: '2026-01-08T00:00:00Z', doneAt: '2026-01-08T06:00:00Z' }, // 6h
    ]);
    expect(result.score).toBeGreaterThan(50);
    expect(result.lowConfidence).toBe(false);
  });

  test('cycle time qui augmente dans le temps → score < 50', () => {
    const result = computeSLI([
      { taskId: 't1', createdAt: '2026-01-01T00:00:00Z', doneAt: '2026-01-01T06:00:00Z' }, // 6h
      { taskId: 't2', createdAt: '2026-01-02T00:00:00Z', doneAt: '2026-01-02T06:00:00Z' }, // 6h
      { taskId: 't3', createdAt: '2026-01-03T00:00:00Z', doneAt: '2026-01-05T00:00:00Z' }, // 48h
      { taskId: 't4', createdAt: '2026-01-06T00:00:00Z', doneAt: '2026-01-08T00:00:00Z' }, // 48h
    ]);
    expect(result.score).toBeLessThan(50);
  });
});

// ─── Emotional KPIs ─────────────────────────────────────────────────────────

describe('Emotional KPIs (CDC §16)', () => {
  test('board vide → valeurs par défaut saines', () => {
    const result = computeEmotionalKpis([], []);
    expect(result.deadlineSafety).toBe(100);
    expect(result.bottleneckScore).toBe(100);
    expect(result.blockedTimeRatio).toBe(0);
    expect(result.riskVelocity).toBe(0);
  });

  test('tâche en retard de plus de 24h → deadlineSafety baisse', () => {
    const now = Date.now();
    const tasks = [
      taskRow({ id: 't1', status_slug: 'doing', due_date: new Date(now - 48 * 3_600_000).toISOString() }),
    ];
    const result = computeEmotionalKpis(tasks, [], now);
    expect(result.deadlineSafety).toBe(0);
  });

  test('note "blocked" dans l\'historique → blockedTimeRatio > 0', () => {
    const history = [
      historyRow({ note: 'blocked waiting for API access' }),
      historyRow({ note: null }),
    ];
    const result = computeEmotionalKpis([], history);
    expect(result.blockedTimeRatio).toBe(50);
  });
});

// ─── Module 2 — Permissions (nouvelles actions) ────────────────────────────

describe('Module 2 — Permissions étendues (CDC §9)', () => {
  test('developer ne peut pas assigner de tâche', () => {
    expect(hasPermission('developer', 'assign_task')).toBe(false);
  });

  test('manager et admin peuvent assigner une tâche', () => {
    expect(hasPermission('manager', 'assign_task')).toBe(true);
    expect(hasPermission('admin', 'assign_task')).toBe(true);
  });

  test('developer peut voir ses propres signaux comportementaux', () => {
    expect(hasPermission('developer', 'view_behavioral_signals')).toBe(true);
  });

  test('seul admin peut gérer les utilisateurs', () => {
    expect(hasPermission('developer', 'manage_users')).toBe(false);
    expect(hasPermission('manager', 'manage_users')).toBe(false);
    expect(hasPermission('admin', 'manage_users')).toBe(true);
  });

  test('getPermissions expose bien toutes les nouvelles actions', () => {
    const perms = getPermissions('manager');
    expect(perms).toHaveProperty('assign_task');
    expect(perms).toHaveProperty('move_task');
    expect(perms).toHaveProperty('view_behavioral_signals');
    expect(perms).toHaveProperty('manage_kpi_rules');
    expect(perms).toHaveProperty('configure_integrations');
    expect(perms).toHaveProperty('validate_ai_actions');
  });
});
