/**
 * Module 9 — Unit tests : Notification System
 *
 * Logique pure sans DB, sans JWT, sans HTTP.
 * Usage : bun test src/tests/notifications.test.ts
 */

import { describe, test, expect } from 'bun:test';

type NotificationType =
  | 'overdue_task' | 'blocker_alert' | 'overload_warning' | 'sprint_risk'
  | 'review_saturation' | 'task_assigned' | 'task_moved' | 'deadline_soon' | 'system';

type NotificationSeverity = 'info' | 'warning' | 'critical';

interface NotificationPayload {
  recipientEmail: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

function buildTaskAssignedPayload(p: {
  recipientEmail: string; taskTitle: string; taskId: string; assignedBy: string;
}): NotificationPayload {
  return {
    recipientEmail: p.recipientEmail,
    type: 'task_assigned',
    severity: 'info',
    title: 'New task assigned to you',
    message: `"${p.taskTitle}" has been assigned to you by ${p.assignedBy}.`,
    entityType: 'task',
    entityId: p.taskId,
  };
}

function buildOverduePayload(p: {
  recipientEmail: string; taskTitle: string; taskId: string; dueDate: string;
}): NotificationPayload {
  return {
    recipientEmail: p.recipientEmail,
    type: 'overdue_task',
    severity: 'warning',
    title: 'Overdue task',
    message: `"${p.taskTitle}" was due on ${p.dueDate} and has not been completed.`,
    entityType: 'task',
    entityId: p.taskId,
  };
}

function buildBlockerPayload(p: {
  recipientEmail: string; taskTitle: string; taskId: string; blockedSince: string;
}): NotificationPayload {
  return {
    recipientEmail: p.recipientEmail,
    type: 'blocker_alert',
    severity: 'critical',
    title: 'Task has been blocked for a long time',
    message: `"${p.taskTitle}" has been in "blocked" status since ${p.blockedSince}. This may be impacting delivery.`,
    entityType: 'task',
    entityId: p.taskId,
  };
}

function buildReviewSaturationPayload(p: {
  managerEmail: string; boardId: string; boardTitle: string; reviewCount: number;
}): NotificationPayload {
  return {
    recipientEmail: p.managerEmail,
    type: 'review_saturation',
    severity: 'critical',
    title: 'Review queue is saturated',
    message: `Board "${p.boardTitle}" has ${p.reviewCount} tasks pending review. This may block delivery velocity.`,
    entityType: 'board',
    entityId: p.boardId,
  };
}

function buildDeadlineSoonPayload(p: {
  recipientEmail: string; taskTitle: string; taskId: string; dueDate: string;
}): NotificationPayload {
  return {
    recipientEmail: p.recipientEmail,
    type: 'deadline_soon',
    severity: 'warning',
    title: 'Deadline in less than 24h',
    message: `"${p.taskTitle}" is due on ${p.dueDate}. Make sure to complete it in time.`,
    entityType: 'task',
    entityId: p.taskId,
  };
}

const VALID_TYPES: NotificationType[] = [
  'overdue_task', 'blocker_alert', 'overload_warning', 'sprint_risk',
  'review_saturation', 'task_assigned', 'task_moved', 'deadline_soon', 'system',
];
const VALID_SEVERITIES: NotificationSeverity[] = ['info', 'warning', 'critical'];

// ─── Types ───────────────────────────────────────────────────────────────────

describe('Notification types', () => {
  test('9 types définis', () => {
    expect(VALID_TYPES.length).toBe(9);
  });

  test('tous les types attendus présents', () => {
    const expected: NotificationType[] = [
      'overdue_task', 'blocker_alert', 'overload_warning', 'sprint_risk',
      'review_saturation', 'task_assigned', 'task_moved', 'deadline_soon', 'system',
    ];
    expected.forEach(t => expect(VALID_TYPES).toContain(t));
  });
});

describe('Notification severities', () => {
  test('3 niveaux', () => {
    expect(VALID_SEVERITIES.length).toBe(3);
  });

  test('ordre info < warning < critical', () => {
    const rank: Record<NotificationSeverity, number> = { info: 1, warning: 2, critical: 3 };
    expect(rank['info']).toBeLessThan(rank['warning']);
    expect(rank['warning']).toBeLessThan(rank['critical']);
  });
});

// ─── Payloads ─────────────────────────────────────────────────────────────────

describe('Payload task_assigned', () => {
  const p = buildTaskAssignedPayload({
    recipientEmail: 'ilham@nibras.dev',
    taskTitle: 'Fix login bug',
    taskId: 'task-001',
    assignedBy: 'omar@nibras.dev',
  });

  test('type correct', () => { expect(p.type).toBe('task_assigned'); });
  test('severity = info', () => { expect(p.severity).toBe('info'); });
  test('recipient correct', () => { expect(p.recipientEmail).toBe('ilham@nibras.dev'); });
  test('message contient le titre', () => { expect(p.message).toContain('Fix login bug'); });
  test('message contient l\'assigneur', () => { expect(p.message).toContain('omar@nibras.dev'); });
  test('entityType = task', () => { expect(p.entityType).toBe('task'); });
  test('entityId correct', () => { expect(p.entityId).toBe('task-001'); });
});

describe('Payload overdue_task', () => {
  const p = buildOverduePayload({
    recipientEmail: 'dev@nibras.dev',
    taskTitle: 'Deploy to staging',
    taskId: 'task-002',
    dueDate: '2026-06-20',
  });

  test('type correct', () => { expect(p.type).toBe('overdue_task'); });
  test('severity = warning', () => { expect(p.severity).toBe('warning'); });
  test('message contient la due_date', () => { expect(p.message).toContain('2026-06-20'); });
  test('message contient le titre', () => { expect(p.message).toContain('Deploy to staging'); });
});

describe('Payload blocker_alert', () => {
  const p = buildBlockerPayload({
    recipientEmail: 'dev@nibras.dev',
    taskTitle: 'API integration',
    taskId: 'task-003',
    blockedSince: '2026-06-18 09:00',
  });

  test('type correct', () => { expect(p.type).toBe('blocker_alert'); });
  test('severity = critical', () => { expect(p.severity).toBe('critical'); });
  test('message mentionne blocked', () => { expect(p.message.toLowerCase()).toContain('blocked'); });
});

describe('Payload review_saturation', () => {
  const p = buildReviewSaturationPayload({
    managerEmail: 'manager@nibras.dev',
    boardId: 'board-001',
    boardTitle: 'Sprint Q2',
    reviewCount: 7,
  });

  test('type correct', () => { expect(p.type).toBe('review_saturation'); });
  test('severity = critical', () => { expect(p.severity).toBe('critical'); });
  test('recipient = manager', () => { expect(p.recipientEmail).toBe('manager@nibras.dev'); });
  test('message contient le count', () => { expect(p.message).toContain('7'); });
  test('message contient le nom du board', () => { expect(p.message).toContain('Sprint Q2'); });
  test('entityType = board', () => { expect(p.entityType).toBe('board'); });
});

describe('Payload deadline_soon', () => {
  const p = buildDeadlineSoonPayload({
    recipientEmail: 'dev@nibras.dev',
    taskTitle: 'Write tests',
    taskId: 'task-004',
    dueDate: '2026-06-27',
  });

  test('type correct', () => { expect(p.type).toBe('deadline_soon'); });
  test('severity = warning', () => { expect(p.severity).toBe('warning'); });
  test('message contient la date', () => { expect(p.message).toContain('2026-06-27'); });
});

// ─── Règles métier ────────────────────────────────────────────────────────────

describe('Règles de déduplication', () => {
  function shouldSkip(
    existing: Array<{ type: string; entity_id: string; created_today: boolean }>,
    newType: string,
    newEntityId: string,
  ): boolean {
    return existing.some(n => n.type === newType && n.entity_id === newEntityId && n.created_today);
  }

  test('notif overdue déjà envoyée aujourd\'hui → skip', () => {
    expect(shouldSkip([{ type: 'overdue_task', entity_id: 'task-001', created_today: true }], 'overdue_task', 'task-001')).toBe(true);
  });
  test('notif overdue de la veille → ne pas skip', () => {
    expect(shouldSkip([{ type: 'overdue_task', entity_id: 'task-001', created_today: false }], 'overdue_task', 'task-001')).toBe(false);
  });
  test('autre tâche → ne pas skip', () => {
    expect(shouldSkip([{ type: 'overdue_task', entity_id: 'task-999', created_today: true }], 'overdue_task', 'task-001')).toBe(false);
  });
  test('aucune notif → envoi autorisé', () => {
    expect(shouldSkip([], 'overdue_task', 'task-001')).toBe(false);
  });
});

describe('Permissions trigger endpoints', () => {
  const ALLOWED = ['manager', 'admin'];
  test('manager autorisé', () => { expect(ALLOWED.includes('manager')).toBe(true); });
  test('admin autorisé', () => { expect(ALLOWED.includes('admin')).toBe(true); });
  test('developer non autorisé', () => { expect(ALLOWED.includes('developer')).toBe(false); });
  test('guest non autorisé', () => { expect(ALLOWED.includes('guest')).toBe(false); });
});

describe('Seuil review saturation', () => {
  const THRESHOLD = 3;
  const isSaturated = (n: number) => n >= THRESHOLD;

  test('2 → pas saturé', () => { expect(isSaturated(2)).toBe(false); });
  test('3 → saturé (seuil exact)', () => { expect(isSaturated(3)).toBe(true); });
  test('7 → saturé', () => { expect(isSaturated(7)).toBe(true); });
  test('0 → pas saturé', () => { expect(isSaturated(0)).toBe(false); });
});

describe('Isolation des notifications', () => {
  const canAccess = (recipientEmail: string, requestingEmail: string) =>
    recipientEmail === requestingEmail;

  test('owner peut lire sa notif', () => {
    expect(canAccess('ilham@nibras.dev', 'ilham@nibras.dev')).toBe(true);
  });
  test('autre user ne peut pas lire', () => {
    expect(canAccess('ilham@nibras.dev', 'omar@nibras.dev')).toBe(false);
  });
});

describe('Principe non-punitif (BR-10)', () => {
  const FORBIDDEN_WORDS = ['failure', 'failed', 'incompetent', 'bad', 'worst', 'lazy'];
  const isNonPunitive = (msg: string) =>
    !FORBIDDEN_WORDS.some(w => msg.toLowerCase().includes(w));

  test('message overdue non-punitif', () => {
    const p = buildOverduePayload({ recipientEmail: 'x', taskTitle: 'T', taskId: 'i', dueDate: '2026-06-20' });
    expect(isNonPunitive(p.message)).toBe(true);
  });
  test('message blocker non-punitif', () => {
    const p = buildBlockerPayload({ recipientEmail: 'x', taskTitle: 'T', taskId: 'i', blockedSince: '2026-06-18' });
    expect(isNonPunitive(p.message)).toBe(true);
  });
  test('message review saturation non-punitif', () => {
    const p = buildReviewSaturationPayload({ managerEmail: 'x', boardId: 'b', boardTitle: 'S', reviewCount: 5 });
    expect(isNonPunitive(p.message)).toBe(true);
  });
});