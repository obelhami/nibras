/**
 * AI Engine demo seed — Module 8 (AI-01 / AI-02 / AI-03).
 *
 * Creates a self-contained demo team with two boards whose data is crafted
 * to trigger every AI Engine feature, so a live demo needs zero manual setup:
 *
 *   - Team  "AI Demo Team"        (aidemo-team-0001)   → AI-01 + AI-03
 *   - Board "Sprint Alpha (risqué)"  (aidemo-board-alpha) → AI-02 verdict critical
 *   - Board "Sprint Beta (saine)"    (aidemo-board-beta)  → AI-02 verdict healthy
 *
 * Sprint Alpha story: 7 tasks stuck in review for ~8 days that NOBODY is
 * validating, 6 overdue tasks, 5 blocker notes, all recent deliveries late.
 * → AI-01 fires review_saturation / team_critical / delivery_delays /
 *   overdue_backlog / blocker_triage; the Brain concludes the review stage
 *   (not the team) is the constraint; Sprint Doctor scores it critical.
 *
 * Idempotent: every row id starts with "aidemo-", and the script deletes all
 * previous aidemo- rows before inserting. Re-run any time to reset the demo.
 *
 * Usage (from backend/):  bun run seed-ai-demo.ts
 */

import { db } from './db';
import bcrypt from 'bcryptjs';

const TEAM_ID = 'aidemo-team-0001';
const BOARD_ALPHA = 'aidemo-board-alpha';
const BOARD_BETA = 'aidemo-board-beta';
const PROJECT_ID = 'aidemo-project-0001';

const MANAGER = 'manager@nibras.demo';
const DEV1 = 'dev1@nibras.demo';
const DEV2 = 'dev2@nibras.demo';

const DAY_MS = 86_400_000;
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Reuse the existing demo account, or create it (password demo1234). */
async function ensureUser(email: string, username: string, role: string): Promise<string> {
  const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  if (existing.rows.length > 0) return String(existing.rows[0]!.id);

  const hash = await bcrypt.hash('demo1234', 10);
  await db.execute({
    sql: `INSERT INTO users (username, email, password, is_verified, role) VALUES (?, ?, ?, 1, ?)`,
    args: [username, email, hash, role],
  });
  const created = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  return String(created.rows[0]!.id);
}

async function cleanup() {
  await db.execute(`DELETE FROM task_history WHERE board_id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM tasks WHERE board_id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM board_columns WHERE board_id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM boards WHERE id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM project_teams WHERE team_id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM projects WHERE id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM team_members WHERE team_id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM teams WHERE id LIKE 'aidemo-%'`);
  await db.execute(`DELETE FROM ai_insights WHERE scope_id LIKE 'aidemo-%'`);
}

type ColumnDef = { id: string; slug: string; name: string; position: number };

function columnsFor(boardId: string): ColumnDef[] {
  return [
    { id: `${boardId}-col-todo`, slug: 'todo', name: 'To Do', position: 0 },
    { id: `${boardId}-col-doing`, slug: 'doing', name: 'Doing', position: 1 },
    { id: `${boardId}-col-review`, slug: 'review', name: 'Review', position: 2 },
    { id: `${boardId}-col-done`, slug: 'done', name: 'Done', position: 3 },
  ];
}

async function insertBoard(boardId: string, title: string, linkedProject: string | null) {
  await db.execute({
    sql: `INSERT INTO boards (id, title, source, linked_project, visibility, team_id, owner_email, created_at, updated_at)
          VALUES (?, ?, 'manual', ?, 'private', ?, ?, ?, ?)`,
    args: [boardId, title, linkedProject, TEAM_ID, MANAGER, daysAgo(30), daysAgo(1)],
  });
  for (const column of columnsFor(boardId)) {
    await db.execute({
      sql: `INSERT INTO board_columns (id, board_id, name, slug, position, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [column.id, boardId, column.name, column.slug, column.position, daysAgo(30)],
    });
  }
}

type TaskSeed = {
  id: string;
  board: string;
  title: string;
  status: 'todo' | 'doing' | 'review' | 'done';
  assignee: string;
  createdDaysAgo: number;
  dueDaysAgo: number | null; // positive = overdue, negative = due in the future
  priority?: string;
};

async function insertTask(task: TaskSeed) {
  await db.execute({
    sql: `INSERT INTO tasks
            (id, board_id, column_id, title, description, priority, status_slug,
             due_date, assignee_email, created_by_email, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id,
      task.board,
      `${task.board}-col-${task.status}`,
      task.title,
      'Seeded for the AI Engine demo',
      task.priority ?? 'medium',
      task.status,
      task.dueDaysAgo == null ? null : daysAgo(task.dueDaysAgo),
      task.assignee,
      MANAGER,
      daysAgo(task.createdDaysAgo),
      daysAgo(Math.min(task.createdDaysAgo, 1)),
    ],
  });
}

type MoveSeed = {
  id: string;
  task: string;
  board: string;
  from: 'todo' | 'doing' | 'review' | 'done' | null;
  to: 'todo' | 'doing' | 'review' | 'done';
  by: string;
  daysAgo: number;
  note?: string;
};

async function insertMove(move: MoveSeed) {
  await db.execute({
    sql: `INSERT INTO task_history
            (id, task_id, board_id, from_column_id, to_column_id,
             from_status_slug, to_status_slug, moved_by_email, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      move.id,
      move.task,
      move.board,
      move.from ? `${move.board}-col-${move.from}` : null,
      `${move.board}-col-${move.to}`,
      move.from,
      move.to,
      move.by,
      move.note ?? null,
      daysAgo(move.daysAgo),
    ],
  });
}

async function main() {
  console.log('🧹 Removing previous aidemo- rows…');
  await cleanup();

  console.log('👤 Resolving demo accounts…');
  const managerId = await ensureUser(MANAGER, 'Mona Manager', 'manager');
  const dev1Id = await ensureUser(DEV1, 'Ali Developer', 'developer');
  const dev2Id = await ensureUser(DEV2, 'Sara Developer', 'developer');

  console.log('👥 Creating team, project and boards…');
  await db.execute({
    sql: `INSERT INTO teams (id, name, manager_id, created_at) VALUES (?, 'AI Demo Team', ?, ?)`,
    args: [TEAM_ID, managerId, daysAgo(30)],
  });
  for (const userId of [managerId, dev1Id, dev2Id]) {
    await db.execute({
      sql: 'INSERT INTO team_members (team_id, user_id) VALUES (?, ?)',
      args: [TEAM_ID, userId],
    });
  }
  // NOTE: the live projects table references users(id) in created_by (not an email).
  await db.execute({
    sql: `INSERT INTO projects (id, name, description, status, created_by, team_id)
          VALUES (?, 'AI Demo Project', 'Seeded for the AI Engine demo', 'active', ?, ?)`,
    args: [PROJECT_ID, managerId, TEAM_ID],
  });
  await db.execute({
    sql: 'INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)',
    args: [PROJECT_ID, TEAM_ID],
  });
  await insertBoard(BOARD_ALPHA, 'Sprint Alpha (risqué)', PROJECT_ID);
  await insertBoard(BOARD_BETA, 'Sprint Beta (saine)', null);

  console.log('📋 Seeding Sprint Alpha (the sick sprint)…');
  // 7 tasks stuck in review for ~8 days — nobody validates them.
  // r1..r5 are also overdue; the doing→review moves carry blocker notes.
  const reviewTasks = [1, 2, 3, 4, 5, 6, 7].map((n): TaskSeed => ({
    id: `aidemo-a-r${n}`,
    board: BOARD_ALPHA,
    title: `Feature validation ${n}`,
    status: 'review',
    assignee: DEV1,
    createdDaysAgo: 12,
    dueDaysAgo: n <= 5 ? 5 : -5,
    priority: n <= 3 ? 'high' : 'medium',
  }));
  // 2 in doing (d1 overdue → 6 overdue total on the board), 1 in todo.
  const activeTasks: TaskSeed[] = [
    { id: 'aidemo-a-d1', board: BOARD_ALPHA, title: 'API refactor', status: 'doing', assignee: DEV1, createdDaysAgo: 9, dueDaysAgo: 3 },
    { id: 'aidemo-a-d2', board: BOARD_ALPHA, title: 'Fix login bug', status: 'doing', assignee: DEV2, createdDaysAgo: 5, dueDaysAgo: -4 },
    { id: 'aidemo-a-t1', board: BOARD_ALPHA, title: 'Write docs', status: 'todo', assignee: DEV2, createdDaysAgo: 3, dueDaysAgo: -7 },
  ];
  // 4 tasks delivered in the last 3 days (all in one week → unstable velocity),
  // 3 of them after their due date (75% late) and ~18 days after creation (slow ADT).
  // They went doing→done directly, so ZERO review exits: the review queue is
  // genuinely stuck, which is what the Brain should discover.
  const doneTasks: TaskSeed[] = [
    { id: 'aidemo-a-x1', board: BOARD_ALPHA, title: 'Setup CI', status: 'done', assignee: DEV2, createdDaysAgo: 20, dueDaysAgo: 10 },
    { id: 'aidemo-a-x2', board: BOARD_ALPHA, title: 'DB migration', status: 'done', assignee: DEV2, createdDaysAgo: 20, dueDaysAgo: 10 },
    { id: 'aidemo-a-x3', board: BOARD_ALPHA, title: 'Landing page', status: 'done', assignee: DEV1, createdDaysAgo: 20, dueDaysAgo: 10 },
    { id: 'aidemo-a-x4', board: BOARD_ALPHA, title: 'Email templates', status: 'done', assignee: DEV2, createdDaysAgo: 20, dueDaysAgo: 1 },
  ];
  for (const task of [...reviewTasks, ...activeTasks, ...doneTasks]) await insertTask(task);

  let h = 0;
  const move = (partial: Omit<MoveSeed, 'id'>) =>
    insertMove({ id: `aidemo-h-${++h}`, ...partial });

  for (const [index, task] of reviewTasks.entries()) {
    const n = index + 1;
    await move({ task: task.id, board: BOARD_ALPHA, from: 'todo', to: 'doing', by: DEV1, daysAgo: 10 });
    await move({
      task: task.id, board: BOARD_ALPHA, from: 'doing', to: 'review', by: DEV1, daysAgo: 8,
      // 5 blocker notes → blocker_triage (AI-01) + sprint_blockers (AI-02)
      note: n <= 5 ? 'blocked: waiting on client validation' : undefined,
    });
  }
  await move({ task: 'aidemo-a-d1', board: BOARD_ALPHA, from: 'todo', to: 'doing', by: DEV1, daysAgo: 7 });
  await move({ task: 'aidemo-a-d2', board: BOARD_ALPHA, from: 'todo', to: 'doing', by: DEV2, daysAgo: 5 });
  // one piece of rework for flavor (backward move doing → todo, then forward again)
  await move({ task: 'aidemo-a-d2', board: BOARD_ALPHA, from: 'doing', to: 'todo', by: DEV2, daysAgo: 4, note: 'spec changed' });
  await move({ task: 'aidemo-a-d2', board: BOARD_ALPHA, from: 'todo', to: 'doing', by: DEV2, daysAgo: 3 });
  for (const [index, task] of doneTasks.entries()) {
    await move({ task: task.id, board: BOARD_ALPHA, from: 'todo', to: 'doing', by: task.assignee, daysAgo: 16 });
    await move({ task: task.id, board: BOARD_ALPHA, from: 'doing', to: 'done', by: task.assignee, daysAgo: 1 + index * 0.7 });
  }

  console.log('📋 Seeding Sprint Beta (the healthy sprint)…');
  const betaDone: TaskSeed[] = [
    { id: 'aidemo-b-x1', board: BOARD_BETA, title: 'Search filter', status: 'done', assignee: DEV2, createdDaysAgo: 12, dueDaysAgo: -2 },
    { id: 'aidemo-b-x2', board: BOARD_BETA, title: 'Avatar upload', status: 'done', assignee: DEV1, createdDaysAgo: 10, dueDaysAgo: -3 },
    { id: 'aidemo-b-x3', board: BOARD_BETA, title: 'Dark mode', status: 'done', assignee: DEV2, createdDaysAgo: 8, dueDaysAgo: -2 },
  ];
  const betaActive: TaskSeed[] = [
    { id: 'aidemo-b-d1', board: BOARD_BETA, title: 'Export CSV', status: 'doing', assignee: DEV1, createdDaysAgo: 2, dueDaysAgo: -5 },
    { id: 'aidemo-b-d2', board: BOARD_BETA, title: 'Notification badge', status: 'doing', assignee: DEV2, createdDaysAgo: 2, dueDaysAgo: -6 },
  ];
  for (const task of [...betaDone, ...betaActive]) await insertTask(task);
  const betaDoneDays = [9, 6, 2];
  for (const [index, task] of betaDone.entries()) {
    await move({ task: task.id, board: BOARD_BETA, from: 'todo', to: 'doing', by: task.assignee, daysAgo: betaDoneDays[index]! + 2 });
    await move({ task: task.id, board: BOARD_BETA, from: 'doing', to: 'done', by: task.assignee, daysAgo: betaDoneDays[index]! });
  }
  for (const task of betaActive) {
    await move({ task: task.id, board: BOARD_BETA, from: 'todo', to: 'doing', by: task.assignee, daysAgo: 1 });
  }

  console.log(`
✅ AI Engine demo data ready.

  Team    (AI-01, AI-03):  ${TEAM_ID}
  Board A (AI-02 critical): ${BOARD_ALPHA}
  Board B (AI-02 healthy):  ${BOARD_BETA}
  Login:  ${MANAGER} / demo1234

Demo endpoints:
  GET  /ai/teams/${TEAM_ID}/recommendations
  GET  /ai/boards/${BOARD_ALPHA}/sprint-doctor
  GET  /ai/boards/${BOARD_BETA}/sprint-doctor
  GET  /ai/teams/${TEAM_ID}/brain
  GET  /ai/insights?scope=team&scopeId=${TEAM_ID}&status=pending
  PATCH /ai/insights/:id  {"action":"accept"}

Or import Nibras_AI_Engine.postman_collection.json (project root) and run "1. Login" first.
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  });
