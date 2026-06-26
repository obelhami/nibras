/**
 * Module 9 — Notification System
 * Service de création et lecture des notifications.
 * Utilisé par les routes ET les autres modules (tasks, behavior, kpi)
 * pour déclencher des alertes de manière centralisée.
 */

import { db } from '../../db';
import crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'overdue_task'       // Tâche dépassant sa due_date
  | 'blocker_alert'      // Tâche bloquée depuis trop longtemps
  | 'overload_warning'   // Surcharge silencieuse détectée
  | 'sprint_risk'        // Sprint en danger
  | 'review_saturation'  // File de review saturée
  | 'task_assigned'      // Nouvelle tâche assignée
  | 'task_moved'         // Tâche déplacée (changement de colonne)
  | 'deadline_soon'      // Deadline dans moins de 24h
  | 'system';            // Message système générique

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationRow {
  id: string;
  recipient_email: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

// ─── Migration helper ────────────────────────────────────────────────────────

export async function runNotificationsMigration() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id              TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      type            TEXT NOT NULL,
      severity        TEXT NOT NULL DEFAULT 'info',
      title           TEXT NOT NULL,
      message         TEXT NOT NULL,
      entity_type     TEXT DEFAULT NULL,
      entity_id       TEXT DEFAULT NULL,
      read_at         TEXT DEFAULT NULL,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient
    ON notifications(recipient_email, created_at DESC)
  `);

  console.log('✅ Notifications migration applied');
}

// ─── Core: créer une notification ───────────────────────────────────────────

export async function createNotification(payload: {
  recipientEmail: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();

  await db.execute({
    sql: `
      INSERT INTO notifications
        (id, recipient_email, type, severity, title, message, entity_type, entity_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      payload.recipientEmail,
      payload.type,
      payload.severity ?? 'info',
      payload.title,
      payload.message,
      payload.entityType ?? null,
      payload.entityId ?? null,
    ],
  });

  return id;
}

// ─── Helpers métier ──────────────────────────────────────────────────────────

export async function notifyTaskAssigned(params: {
  recipientEmail: string;
  taskTitle: string;
  taskId: string;
  boardId: string;
  assignedBy: string;
}) {
  return createNotification({
    recipientEmail: params.recipientEmail,
    type: 'task_assigned',
    severity: 'info',
    title: 'New task assigned to you',
    message: `"${params.taskTitle}" has been assigned to you by ${params.assignedBy}.`,
    entityType: 'task',
    entityId: params.taskId,
  });
}

export async function notifyTaskMoved(params: {
  recipientEmail: string;
  taskTitle: string;
  taskId: string;
  fromColumn: string;
  toColumn: string;
  movedBy: string;
}) {
  return createNotification({
    recipientEmail: params.recipientEmail,
    type: 'task_moved',
    severity: 'info',
    title: 'Task status updated',
    message: `"${params.taskTitle}" moved from "${params.fromColumn}" to "${params.toColumn}" by ${params.movedBy}.`,
    entityType: 'task',
    entityId: params.taskId,
  });
}

export async function notifyOverdueTask(params: {
  recipientEmail: string;
  taskTitle: string;
  taskId: string;
  dueDate: string;
}) {
  return createNotification({
    recipientEmail: params.recipientEmail,
    type: 'overdue_task',
    severity: 'warning',
    title: 'Overdue task',
    message: `"${params.taskTitle}" was due on ${params.dueDate} and has not been completed.`,
    entityType: 'task',
    entityId: params.taskId,
  });
}

export async function notifyDeadlineSoon(params: {
  recipientEmail: string;
  taskTitle: string;
  taskId: string;
  dueDate: string;
}) {
  return createNotification({
    recipientEmail: params.recipientEmail,
    type: 'deadline_soon',
    severity: 'warning',
    title: 'Deadline in less than 24h',
    message: `"${params.taskTitle}" is due on ${params.dueDate}. Make sure to complete it in time.`,
    entityType: 'task',
    entityId: params.taskId,
  });
}

export async function notifyBlockerAlert(params: {
  recipientEmail: string;
  taskTitle: string;
  taskId: string;
  blockedSince: string;
}) {
  return createNotification({
    recipientEmail: params.recipientEmail,
    type: 'blocker_alert',
    severity: 'critical',
    title: 'Task has been blocked for a long time',
    message: `"${params.taskTitle}" has been in "blocked" status since ${params.blockedSince}. This may be impacting delivery.`,
    entityType: 'task',
    entityId: params.taskId,
  });
}

export async function notifyOverloadWarning(params: {
  recipientEmail: string;
  managerEmail: string;
  taskCount: number;
}) {
  await createNotification({
    recipientEmail: params.recipientEmail,
    type: 'overload_warning',
    severity: 'warning',
    title: 'High workload detected',
    message: `You currently have ${params.taskCount} active tasks. Consider flagging blockers or discussing prioritization with your manager.`,
    entityType: 'user',
    entityId: params.recipientEmail,
  });

  if (params.managerEmail !== params.recipientEmail) {
    await createNotification({
      recipientEmail: params.managerEmail,
      type: 'overload_warning',
      severity: 'warning',
      title: 'Team member overload signal',
      message: `${params.recipientEmail} has ${params.taskCount} active tasks assigned. Review workload distribution.`,
      entityType: 'user',
      entityId: params.recipientEmail,
    });
  }
}

export async function notifyReviewSaturation(params: {
  managerEmail: string;
  boardId: string;
  boardTitle: string;
  reviewCount: number;
}) {
  return createNotification({
    recipientEmail: params.managerEmail,
    type: 'review_saturation',
    severity: 'critical',
    title: 'Review queue is saturated',
    message: `Board "${params.boardTitle}" has ${params.reviewCount} tasks pending review. This may block delivery velocity.`,
    entityType: 'board',
    entityId: params.boardId,
  });
}

export async function notifySprintRisk(params: {
  managerEmail: string;
  message: string;
  entityId?: string;
}) {
  return createNotification({
    recipientEmail: params.managerEmail,
    type: 'sprint_risk',
    severity: 'critical',
    title: 'Sprint risk detected',
    message: params.message,
    entityType: 'board',
    entityId: params.entityId,
  });
}