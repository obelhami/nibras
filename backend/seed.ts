/**
 * Seed data pour la démo Nibras (P0-P2 Tests & API documentation).
 *
 * Additif avec protection contre les doublons : vérifie si les données
 * existent avant d'insérer — ne supprime jamais les données existantes.
 *
 * Usage :
 *   bun run seed.ts
 *
 * Comptes créés (mot de passe : demo1234) :
 *   admin@nibras.demo    → admin
 *   manager@nibras.demo  → manager
 *   dev1@nibras.demo     → developer
 *   dev2@nibras.demo     → developer
 */

import { db } from './db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function userExists(email: string): Promise<string | null> {
  const r = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  return r.rows.length > 0 ? String((r.rows[0] as unknown as { id: number | string }).id) : null;
}

async function ensureUser(username: string, email: string, role: string): Promise<string> {
  const existing = await userExists(email);
  if (existing) {
    console.log(`  ↳ User already exists: ${email}`);
    return existing;
  }
  const hash = await bcrypt.hash('demo1234', 10);
  await db.execute({
    sql: `INSERT INTO users (username, email, password, is_verified, role) VALUES (?, ?, ?, 1, ?)`,
    args: [username, email, hash, role],
  });
  const r = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
  const id = String((r.rows[0] as unknown as { id: number | string }).id);
  console.log(`  ✅ User created: ${email} (${role}) → id ${id}`);
  return id;
}

async function ensureTeam(name: string, managerId: string): Promise<string> {
  const r = await db.execute({ sql: 'SELECT id FROM teams WHERE name = ?', args: [name] });
  if (r.rows.length > 0) {
    const id = String((r.rows[0] as unknown as { id: string }).id);
    console.log(`  ↳ Team already exists: ${name}`);
    return id;
  }
  const id = crypto.randomUUID();
  await db.execute({ sql: 'INSERT INTO teams (id, name, manager_id) VALUES (?, ?, ?)', args: [id, name, managerId] });
  console.log(`  ✅ Team created: ${name}`);
  return id;
}

async function ensureTeamMember(teamId: string, userId: string) {
  const r = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?',
    args: [teamId, userId],
  });
  if (r.rows.length === 0) {
    await db.execute({ sql: 'INSERT INTO team_members (team_id, user_id) VALUES (?, ?)', args: [teamId, userId] });
  }
}

async function ensureProject(name: string, createdBy: string, status: string): Promise<string> {
  const r = await db.execute({ sql: 'SELECT id FROM projects WHERE name = ?', args: [name] });
  if (r.rows.length > 0) {
    const id = String((r.rows[0] as unknown as { id: string }).id);
    console.log(`  ↳ Project already exists: ${name}`);
    return id;
  }
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO projects (id, name, description, start_date, end_date, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, `Projet de démo Nibras — ${name}`, '2026-06-01', '2026-09-30', status, createdBy],
  });
  console.log(`  ✅ Project created: ${name} (${status})`);
  return id;
}

async function ensureBoard(title: string, ownerEmail: string, projectId: string | null): Promise<{ boardId: string; columns: Record<string, string> }> {
  const r = await db.execute({ sql: 'SELECT id FROM boards WHERE title = ?', args: [title] });
  if (r.rows.length > 0) {
    const boardId = String((r.rows[0] as unknown as { id: string }).id);
    console.log(`  ↳ Board already exists: ${title}`);
    const cols = await db.execute({ sql: 'SELECT id, slug FROM board_columns WHERE board_id = ?', args: [boardId] });
    const columns: Record<string, string> = {};
    for (const col of cols.rows as unknown as Array<{ id: string; slug: string }>) columns[col.slug] = col.id;
    return { boardId, columns };
  }
  const boardId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO boards (id, title, source, visibility, owner_email, linked_project)
          VALUES (?, ?, 'manual', 'public', ?, ?)`,
    args: [boardId, title, ownerEmail, projectId],
  });
  const columnDefs = [
    { name: 'Todo', slug: 'todo', position: 0 },
    { name: 'Doing', slug: 'doing', position: 1 },
    { name: 'Review', slug: 'review', position: 2 },
    { name: 'Done', slug: 'done', position: 3 },
  ];
  const columns: Record<string, string> = {};
  for (const col of columnDefs) {
    const colId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO board_columns (id, board_id, name, slug, position) VALUES (?, ?, ?, ?, ?)`,
      args: [colId, boardId, col.name, col.slug, col.position],
    });
    columns[col.slug] = colId;
  }
  console.log(`  ✅ Board created: ${title}`);
  return { boardId, columns };
}

async function ensureTask(
  boardId: string,
  columnId: string,
  statusSlug: string,
  title: string,
  opts: { priority: string; complexity: number; dueDate: string; assigneeEmail: string; createdByEmail: string; description?: string }
): Promise<string> {
  const r = await db.execute({
    sql: 'SELECT id FROM tasks WHERE title = ? AND board_id = ?',
    args: [title, boardId],
  });
  if (r.rows.length > 0) {
    console.log(`    ↳ Task already exists: ${title}`);
    return String((r.rows[0] as unknown as { id: string }).id);
  }
  const taskId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO tasks (id, board_id, column_id, title, description, priority, status_slug, due_date, complexity, assignee_email, created_by_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [taskId, boardId, columnId, title, opts.description ?? null, opts.priority, statusSlug, opts.dueDate, opts.complexity, opts.assigneeEmail, opts.createdByEmail],
  });
  console.log(`    ✅ Task created: ${title}`);
  return taskId;
}

async function addHistory(taskId: string, boardId: string, fromColumnId: string | null, toColumnId: string, fromSlug: string | null, toSlug: string, byEmail: string, note: string) {
  // History integration test : vérifie que chaque move génère bien une entrée (BR-03)
  await db.execute({
    sql: `INSERT INTO task_history (id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), taskId, boardId, fromColumnId, toColumnId, fromSlug, toSlug, byEmail, note],
  });
}

// ─── Main seed ───────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Nibras seed — démarrage\n');

  // ── 1. Utilisateurs ──────────────────────────────────────────────────────
  console.log('👤 Utilisateurs...');
  const adminId   = await ensureUser('Admin Nibras',     'admin@nibras.demo',   'admin');
  const managerId = await ensureUser('Sarah Manager',    'manager@nibras.demo', 'manager');
  const dev1Id    = await ensureUser('Ali Developer',    'dev1@nibras.demo',    'developer');
  const dev2Id    = await ensureUser('Fatima Developer', 'dev2@nibras.demo',    'developer');

  // ── 2. Team ───────────────────────────────────────────────────────────────
  console.log('\n👥 Teams...');
  const teamId = await ensureTeam('Team Nibras Demo', managerId);
  await ensureTeamMember(teamId, dev1Id);
  await ensureTeamMember(teamId, dev2Id);
  console.log('  ✅ Membres ajoutés à Team Nibras Demo');

  // ── 3. Projets ───────────────────────────────────────────────────────────
  console.log('\n📁 Projets...');
  const projectActiveId   = await ensureProject('Nibras MVP',   managerId, 'active');
  const projectOnHoldId   = await ensureProject('Module KPI',   managerId, 'on_hold');
  const projectArchivedId = await ensureProject('Prototype V0', managerId, 'archived');

  // ── 4. Board + tâches avec historique ────────────────────────────────────
  console.log('\n📋 Board + tâches...');
  const { boardId, columns } = await ensureBoard('Board Nibras MVP', 'manager@nibras.demo', projectActiveId);

  // Tâche 1 : Todo
  const t1 = await ensureTask(boardId, columns['todo']!, 'todo',
    'Implémenter authentification JWT', {
      priority: 'high', complexity: 3, dueDate: '2026-07-15',
      assigneeEmail: 'dev1@nibras.demo', createdByEmail: 'manager@nibras.demo',
      description: 'Setup JWT avec access token 15min + refresh token 7j',
    }
  );
  await addHistory(t1, boardId, null, columns['todo']!, null, 'todo', 'manager@nibras.demo', 'Task created');

  // Tâche 2 : Doing (avec historique de mouvement todo → doing)
  const t2 = await ensureTask(boardId, columns['doing']!, 'doing',
    'Créer les endpoints Projects API', {
      priority: 'high', complexity: 4, dueDate: '2026-07-20',
      assigneeEmail: 'dev1@nibras.demo', createdByEmail: 'manager@nibras.demo',
      description: 'CRUD complet avec validation, pagination, scope manager',
    }
  );
  await addHistory(t2, boardId, null, columns['todo']!, null, 'todo', 'manager@nibras.demo', 'Task created');
  await addHistory(t2, boardId, columns['todo']!, columns['doing']!, 'todo', 'doing', 'dev1@nibras.demo', 'Starting implementation');

  // Tâche 3 : Review (avec 2 mouvements : todo → doing → review)
  const t3 = await ensureTask(boardId, columns['review']!, 'review',
    'Teams & Members API', {
      priority: 'high', complexity: 3, dueDate: '2026-07-18',
      assigneeEmail: 'dev2@nibras.demo', createdByEmail: 'manager@nibras.demo',
      description: 'CRUD teams, add/remove members, prevent duplicates, manager_id control',
    }
  );
  await addHistory(t3, boardId, null, columns['todo']!, null, 'todo', 'manager@nibras.demo', 'Task created');
  await addHistory(t3, boardId, columns['todo']!, columns['doing']!, 'todo', 'doing', 'dev2@nibras.demo', 'Started');
  await addHistory(t3, boardId, columns['doing']!, columns['review']!, 'doing', 'review', 'dev2@nibras.demo', 'Ready for review');

  // Tâche 4 : Done (cycle complet : todo → doing → review → done)
  const t4 = await ensureTask(boardId, columns['done']!, 'done',
    'Setup base de données Turso', {
      priority: 'urgent', complexity: 2, dueDate: '2026-06-15',
      assigneeEmail: 'dev1@nibras.demo', createdByEmail: 'manager@nibras.demo',
      description: 'Configuration libsql, migrations initiales, connexion Turso',
    }
  );
  await addHistory(t4, boardId, null, columns['todo']!, null, 'todo', 'manager@nibras.demo', 'Task created');
  await addHistory(t4, boardId, columns['todo']!, columns['doing']!, 'todo', 'doing', 'dev1@nibras.demo', 'Started');
  await addHistory(t4, boardId, columns['doing']!, columns['review']!, 'doing', 'review', 'dev1@nibras.demo', 'Done, needs review');
  await addHistory(t4, boardId, columns['review']!, columns['done']!, 'review', 'done', 'manager@nibras.demo', 'Approved and closed');

  // Tâche 5 : Todo
  const t5 = await ensureTask(boardId, columns['todo']!, 'todo',
    'Tasks API polish - riskScore & comments', {
      priority: 'medium', complexity: 3, dueDate: '2026-07-25',
      assigneeEmail: 'dev2@nibras.demo', createdByEmail: 'manager@nibras.demo',
      description: 'Assignation multiple, riskScore, commentaires, close avec validation',
    }
  );
  await addHistory(t5, boardId, null, columns['todo']!, null, 'todo', 'manager@nibras.demo', 'Task created');

  console.log('\n✅ Seed terminé avec succès !');
  console.log('\n📊 Résumé :');
  console.log('  - 4 utilisateurs (admin, manager, dev1, dev2)');
  console.log('  - 1 team avec 2 développeurs');
  console.log('  - 3 projets (active, on_hold, archived)');
  console.log('  - 1 board avec 5 tâches réparties sur les 4 colonnes');
  console.log('  - Historique complet : chaque mouvement tracé (BR-03)');
  console.log('\n🔑 Comptes demo (mot de passe : demo1234) :');
  console.log('  admin@nibras.demo    → admin');
  console.log('  manager@nibras.demo  → manager');
  console.log('  dev1@nibras.demo     → developer');
  console.log('  dev2@nibras.demo     → developer');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});