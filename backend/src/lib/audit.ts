/**
 * M06 — Audit global et journal de sécurité
 *
 * Service central d'audit. Toute action critique passe par logAuditEvent().
 * La table audit_events est append-only — jamais de UPDATE ni DELETE dessus.
 * Les secrets (tokens, mots de passe) ne sont jamais loggés.
 */

import { db } from '../../db';
import crypto from 'crypto';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'register'
  | 'password_reset_request'
  | 'password_reset_done'
  | 'role_assigned'
  | 'task_deleted'
  | 'task_created'
  | 'task_moved'
  | 'task_updated'
  | 'board_created'
  | 'board_updated'
  | 'board_deleted'
  | 'column_created'
  | 'column_updated'
  | 'column_deleted'
  | 'team_created'
  | 'team_updated'
  | 'team_deleted'
  | 'team_member_added'
  | 'team_member_removed'
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'
  | 'trello_connected'
  | 'trello_disconnected'
  | 'ai_recommendation_validated'
  | 'ai_recommendation_dismissed'
  | 'user_suspended'
  | 'user_activated';

export interface AuditEventPayload {
  action: AuditAction;
  actorEmail: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export async function runAuditMigration() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id            TEXT PRIMARY KEY,
      action        TEXT NOT NULL,
      actor_email   TEXT NOT NULL,
      target_type   TEXT DEFAULT NULL,
      target_id     TEXT DEFAULT NULL,
      details       TEXT DEFAULT NULL,
      ip_address    TEXT DEFAULT NULL,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_email, created_at DESC)`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action, created_at DESC)`
    );
  } catch {
    // index already exists
  }

  console.log('✅ Audit migration applied');
}

export async function logAuditEvent(payload: AuditEventPayload): Promise<void> {
  try {
    await db.execute({
      sql: `
        INSERT INTO audit_events (id, action, actor_email, target_type, target_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        payload.action,
        payload.actorEmail,
        payload.targetType ?? null,
        payload.targetId ?? null,
        payload.details ? JSON.stringify(payload.details) : null,
        payload.ipAddress ?? null,
      ],
    });
  } catch (err) {
    // Audit must never crash the main request
    console.error('[AUDIT] Failed to log event:', err);
  }
}