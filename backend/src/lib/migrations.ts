/**
 * Migrations additives pour Tasks API polish.
 * Appelé une fois au démarrage depuis src/index.ts.
 * N'ajoute que des tables et colonnes nouvelles — ne modifie
 * aucune table existante de façon destructive.
 */

import { db } from '../../db';

export async function runTasksMigrations() {
  // Multi-assignee support (P0 - Tasks API polish)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id    TEXT NOT NULL,
      user_email TEXT NOT NULL,
      assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, user_email),
      FOREIGN KEY (task_id)
        REFERENCES tasks(id)
        ON DELETE CASCADE
    )
  `);

  // Backend comments (P0 - Tasks API polish : "Backend comment if missing")
  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      board_id    TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id)
        REFERENCES tasks(id)
        ON DELETE CASCADE,
      FOREIGN KEY (board_id)
        REFERENCES boards(id)
        ON DELETE CASCADE
    )
  `);

  // risk_score (P0 - Tasks API polish : "riskScore")
  // Settable manuellement pour l'instant ; le KPI Engine
  try {
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN risk_score INTEGER DEFAULT NULL
    `);
  } catch {
  }

  console.log('✅ Tasks migrations applied');
}