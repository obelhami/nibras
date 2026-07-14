/**
 * Migrations additives — Tasks API polish + Module 9 Notifications.
 * Appelé une fois au démarrage depuis src/index.ts.
 */

import { db } from '../../db';
import { runNotificationsMigration } from './notifications';

export async function runTasksMigrations() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id    TEXT NOT NULL,
      user_email TEXT NOT NULL,
      assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, user_email),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      board_id    TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    )
  `);

  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN risk_score INTEGER DEFAULT NULL`);
  } catch {}

  // Module 6 — KPI Engine (PRR: Proactive Recommendation Rate) — flags a task
  // as proposed outside the initial scope, set at creation time.
  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN is_proactive INTEGER DEFAULT 0`);
  } catch {}

  console.log('✅ Tasks migrations applied');

  // Module 1 — Authentication (AUTH-04 / "recover access")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT UNIQUE NOT NULL,
      user_email  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      used_at     TEXT DEFAULT NULL,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Password reset migrations applied');

  // Module 9 — Notification System
  await runNotificationsMigration();
}