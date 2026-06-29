/**
 * Seed data pour la démo Nibras (P0-P2 Tests & API documentation).
 *
 * Additif avec protection contre les doublons : vérifie si les données
 * existent avant d'insérer — ne supprime jamais les données existantes.
 * Le script est idempotent : on peut le relancer sans créer de doublons.
 *
 * Usage :
 *   bun run seed.ts
 *
 * Comptes créés (mot de passe : demo1234) :
 *   admin@nibras.demo    → admin
 *   manager@nibras.demo  → manager
 *   dev1@nibras.demo     → developer
 *   dev2@nibras.demo     → developer
 *   dev3@nibras.demo     → developer
 *
 * Les dates des tâches sont calculées par rapport à la date du jour
 * (daysFromNow) pour que les signaux du board (overdue / deadline_risk /
 * unassigned_high_complexity) restent pertinents quel que soit le jour
 * où le seed est exécuté.
 */

import { db } from './db';
import { recalculateBoardState } from './src/routes/board/metrics';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Date au format YYYY-MM-DD décalée de `days` jours par rapport à aujourd'hui. */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Member = { email: string; id: string };

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

async function ensureBoard(
  title: string,
  ownerEmail: string,
  teamId: string,
  projectId: string | null,
): Promise<{ boardId: string; columns: Record<string, string> }> {
  const r = await db.execute({ sql: 'SELECT id, team_id, linked_project FROM boards WHERE title = ?', args: [title] });
  if (r.rows.length > 0) {
    const row = r.rows[0] as unknown as { id: string; team_id: string | null; linked_project: string | null };
    const boardId = String(row.id);
    console.log(`  ↳ Board already exists: ${title}`);
    // Backfill team / projet sur les anciens boards de démo (créés sans team_id).
    if (!row.team_id || (projectId && !row.linked_project)) {
      await db.execute({
        sql: 'UPDATE boards SET team_id = ?, linked_project = COALESCE(linked_project, ?) WHERE id = ?',
        args: [teamId, projectId, boardId],
      });
      console.log(`    ↳ Board backfilled with team/project: ${title}`);
    }
    const cols = await db.execute({ sql: 'SELECT id, slug FROM board_columns WHERE board_id = ?', args: [boardId] });
    const columns: Record<string, string> = {};
    for (const col of cols.rows as unknown as Array<{ id: string; slug: string }>) columns[col.slug] = col.id;
    return { boardId, columns };
  }
  const boardId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO boards (id, title, source, visibility, team_id, owner_email, linked_project)
          VALUES (?, ?, 'manual', 'public', ?, ?, ?)`,
    args: [boardId, title, teamId, ownerEmail, projectId],
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
  opts: {
    priority: string;
    complexity: number;
    dueDate: string;
    assignee: Member | null;
    createdByEmail: string;
    description?: string;
  }
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
    sql: `INSERT INTO tasks (id, board_id, column_id, title, description, priority, status_slug, due_date, complexity, assignee_email, assignee_id, created_by_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      taskId, boardId, columnId, title, opts.description ?? null, opts.priority, statusSlug, opts.dueDate,
      opts.complexity, opts.assignee?.email ?? null, opts.assignee?.id ?? null, opts.createdByEmail,
    ],
  });
  console.log(`    ✅ Task created: ${title}`);
  return taskId;
}

async function addHistory(
  taskId: string,
  boardId: string,
  fromColumnId: string | null,
  toColumnId: string,
  fromSlug: string | null,
  toSlug: string,
  byEmail: string,
  note: string,
) {
  // History integration test : vérifie que chaque move génère bien une entrée (BR-03).
  // Idempotent : on ne ré-insère pas une entrée déjà présente (relances du seed).
  const existing = await db.execute({
    sql: 'SELECT 1 FROM task_history WHERE task_id = ? AND to_column_id = ? AND note = ?',
    args: [taskId, toColumnId, note],
  });
  if (existing.rows.length > 0) return;
  await db.execute({
    sql: `INSERT INTO task_history (id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), taskId, boardId, fromColumnId, toColumnId, fromSlug, toSlug, byEmail, note],
  });
}

type Status = 'todo' | 'doing' | 'review' | 'done';

type SeedTask = {
  title: string;
  status: Status;
  priority: string;
  complexity: number;
  due: string;
  assignee: Member | null;
  description?: string;
};

/** Crée toutes les tâches d'un board à partir d'une liste déclarative. */
async function seedBoardTasks(
  boardId: string,
  columns: Record<string, string>,
  tasks: SeedTask[],
) {
  for (const tk of tasks) {
    const taskId = await ensureTask(boardId, columns[tk.status]!, tk.status, tk.title, {
      priority: tk.priority,
      complexity: tk.complexity,
      dueDate: tk.due,
      assignee: tk.assignee,
      createdByEmail: 'manager@nibras.demo',
      description: tk.description,
    });

    // Historique synthétique : on rejoue les mouvements jusqu'à la colonne courante.
    const flow: Status[] = ['todo', 'doing', 'review', 'done'];
    const targetIndex = flow.indexOf(tk.status);
    let prevSlug: Status | null = null;
    let prevColId: string | null = null;
    for (let i = 0; i <= targetIndex; i += 1) {
      const slug = flow[i]!;
      const note = i === 0 ? 'Task created' : `Moved to ${slug}`;
      const by = tk.assignee?.email ?? 'manager@nibras.demo';
      await addHistory(taskId, boardId, prevColId, columns[slug]!, prevSlug, slug, by, note);
      prevSlug = slug;
      prevColId = columns[slug]!;
    }
  }
}

// ─── Main seed ───────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Nibras seed — démarrage\n');

  // ── 1. Utilisateurs ──────────────────────────────────────────────────────
  console.log('👤 Utilisateurs...');
  await ensureUser('Admin Nibras', 'admin@nibras.demo', 'admin');
  const managerId = await ensureUser('Sarah Manager', 'manager@nibras.demo', 'manager');
  const dev1Id = await ensureUser('Ali Developer', 'dev1@nibras.demo', 'developer');
  const dev2Id = await ensureUser('Fatima Developer', 'dev2@nibras.demo', 'developer');
  const dev3Id = await ensureUser('Youssef Developer', 'dev3@nibras.demo', 'developer');

  const dev1: Member = { email: 'dev1@nibras.demo', id: dev1Id };
  const dev2: Member = { email: 'dev2@nibras.demo', id: dev2Id };
  const dev3: Member = { email: 'dev3@nibras.demo', id: dev3Id };

  // ── 2. Team ───────────────────────────────────────────────────────────────
  console.log('\n👥 Teams...');
  const teamId = await ensureTeam('Team Nibras Demo', managerId);
  await ensureTeamMember(teamId, dev1Id);
  await ensureTeamMember(teamId, dev2Id);
  await ensureTeamMember(teamId, dev3Id);
  console.log('  ✅ Membres ajoutés à Team Nibras Demo (3 développeurs)');

  // ── 3. Projets ───────────────────────────────────────────────────────────
  console.log('\n📁 Projets...');
  const projectActiveId = await ensureProject('Nibras MVP', managerId, 'active');
  const projectKpiId = await ensureProject('Module KPI', managerId, 'on_hold');
  await ensureProject('Prototype V0', managerId, 'archived');

  // ── 4. Boards + tâches ─────────────────────────────────────────────────────
  // Quatre boards avec des profils volontairement différents pour que le
  // dashboard montre une vraie palette : un board sain, un sprint en cours,
  // un board mobile presque terminé, et un board "bugs" à risque.

  // ── Board A : Board Nibras MVP (le board historique de la démo) ───────────
  console.log('\n📋 Board: Board Nibras MVP...');
  const boardA = await ensureBoard('Board Nibras MVP', 'manager@nibras.demo', teamId, projectActiveId);
  await seedBoardTasks(boardA.boardId, boardA.columns, [
    {
      title: 'Implémenter authentification JWT', status: 'todo', priority: 'high', complexity: 3,
      due: daysFromNow(19), assignee: dev1,
      description: 'Setup JWT avec access token 15min + refresh token 7j',
    },
    {
      title: 'Créer les endpoints Projects API', status: 'doing', priority: 'high', complexity: 4,
      due: daysFromNow(24), assignee: dev1,
      description: 'CRUD complet avec validation, pagination, scope manager',
    },
    {
      title: 'Teams & Members API', status: 'review', priority: 'high', complexity: 3,
      due: daysFromNow(22), assignee: dev2,
      description: 'CRUD teams, add/remove members, prevent duplicates, manager_id control',
    },
    {
      title: 'Setup base de données Turso', status: 'done', priority: 'urgent', complexity: 2,
      due: daysFromNow(-11), assignee: dev1,
      description: 'Configuration libsql, migrations initiales, connexion Turso',
    },
    {
      title: 'Tasks API polish - riskScore & comments', status: 'todo', priority: 'medium', complexity: 3,
      due: daysFromNow(29), assignee: dev2,
      description: 'Assignation multiple, riskScore, commentaires, close avec validation',
    },
    // Tâche non assignée + haute complexité → signal "unassigned_high_complexity".
    {
      title: 'Refonte du moteur de notifications', status: 'todo', priority: 'high', complexity: 5,
      due: daysFromNow(30), assignee: null,
      description: 'Système de notifications temps réel (websocket) — à dispatcher',
    },
    // Échéance proche → signal "deadline_risk".
    {
      title: 'Corriger la régression login OAuth', status: 'doing', priority: 'high', complexity: 4,
      due: daysFromNow(1), assignee: dev2,
      description: 'Le callback Google renvoie un 500 par intermittence',
    },
  ]);

  // ── Board B : Sprint 12 — Delivery (sprint actif, mix complet) ─────────────
  console.log('\n📋 Board: Sprint 12 — Delivery...');
  const boardB = await ensureBoard('Sprint 12 — Delivery', 'manager@nibras.demo', teamId, projectKpiId);
  await seedBoardTasks(boardB.boardId, boardB.columns, [
    {
      title: "Finaliser l'API KPI snapshots", status: 'review', priority: 'high', complexity: 4,
      due: daysFromNow(2), assignee: dev1,
      description: 'Endpoints operational / focus_score / team_pulse + persistance snapshots',
    },
    // En retard → signal "overdue" (critical).
    {
      title: 'Migration Turso vers edge replicas', status: 'doing', priority: 'urgent', complexity: 5,
      due: daysFromNow(-3), assignee: dev1,
      description: 'Réplication multi-région pour réduire la latence des lectures',
    },
    {
      title: 'Documenter les endpoints (Swagger)', status: 'done', priority: 'medium', complexity: 2,
      due: daysFromNow(-10), assignee: dev2,
      description: 'Exposer /docs avec exemples de payloads pour la démo',
    },
    // Non assignée + complexité 4 → signal "unassigned_high_complexity".
    {
      title: 'Page boards : drag & drop des colonnes', status: 'todo', priority: 'high', complexity: 4,
      due: daysFromNow(12), assignee: null,
      description: 'Réordonner les colonnes côté frontend + persistance position',
    },
    {
      title: "Tests d'intégration business rules", status: 'done', priority: 'high', complexity: 3,
      due: daysFromNow(-2), assignee: dev2,
      description: 'Couverture BR-01..BR-05 sur les routes board',
    },
    {
      title: 'Rate limiting sur /auth', status: 'todo', priority: 'medium', complexity: 2,
      due: daysFromNow(18), assignee: dev3,
      description: 'Limiter les tentatives de login/refresh par IP',
    },
  ]);

  // ── Board C : Mobile App — Beta (board sain, presque terminé) ──────────────
  console.log('\n📋 Board: Mobile App — Beta...');
  const boardC = await ensureBoard('Mobile App — Beta', 'manager@nibras.demo', teamId, null);
  await seedBoardTasks(boardC.boardId, boardC.columns, [
    {
      title: "Écran d'onboarding", status: 'done', priority: 'medium', complexity: 2,
      due: daysFromNow(-15), assignee: dev1, description: 'Carrousel 3 écrans + skip',
    },
    {
      title: 'Authentification biométrique', status: 'done', priority: 'high', complexity: 3,
      due: daysFromNow(-8), assignee: dev2, description: 'FaceID / TouchID + fallback PIN',
    },
    {
      title: 'Synchronisation offline', status: 'done', priority: 'high', complexity: 4,
      due: daysFromNow(-5), assignee: dev1, description: 'File de mutations rejouée à la reconnexion',
    },
    {
      title: 'Notifications push', status: 'review', priority: 'medium', complexity: 3,
      due: daysFromNow(6), assignee: dev3, description: 'Intégration FCM + deep links',
    },
    {
      title: 'Crash analytics', status: 'doing', priority: 'low', complexity: 2,
      due: daysFromNow(9), assignee: dev1, description: 'Remontée des crashs + symbolication',
    },
  ]);

  // ── Board D : Bugs & Hotfixes (board à risque, plusieurs alertes) ──────────
  console.log('\n📋 Board: Bugs & Hotfixes...');
  const boardD = await ensureBoard('Bugs & Hotfixes', 'manager@nibras.demo', teamId, null);
  await seedBoardTasks(boardD.boardId, boardD.columns, [
    // En retard → "overdue".
    {
      title: 'Fuite mémoire sur le board detail', status: 'doing', priority: 'urgent', complexity: 4,
      due: daysFromNow(-6), assignee: dev1, description: 'Listeners non nettoyés au démontage du composant',
    },
    // En retard → "overdue".
    {
      title: 'Erreur 500 sur PATCH /tasks', status: 'doing', priority: 'high', complexity: 3,
      due: daysFromNow(-1), assignee: dev2, description: 'assignee_id null casse la requête de mise à jour',
    },
    // Non assignée + complexité 5 + échéance proche → DEUX signaux
    // (unassigned_high_complexity + deadline_risk).
    {
      title: 'Token refresh boucle infinie', status: 'todo', priority: 'urgent', complexity: 5,
      due: daysFromNow(1), assignee: null, description: 'Le client boucle sur /token quand le refresh est expiré',
    },
    // Échéance proche → "deadline_risk".
    {
      title: 'CORS bloque le frontend en prod', status: 'review', priority: 'high', complexity: 2,
      due: daysFromNow(2), assignee: dev2, description: 'Origin de prod absente de la whitelist',
    },
    {
      title: "Corriger le typo dans l'email de vérif", status: 'done', priority: 'low', complexity: 1,
      due: daysFromNow(-3), assignee: dev1, description: 'Faute de frappe dans le template Resend',
    },
  ]);

  // ── 5. Calcul des métriques + signaux pour chaque board ────────────────────
  // Pré-calcule board_metrics et task_signals pour que le dashboard et l'API
  // (/boards/:id et /boards/:id/metrics) renvoient des résultats immédiatement.
  console.log('\n📊 Calcul des métriques & signaux...');
  const boards = [
    { id: boardA.boardId, title: 'Board Nibras MVP' },
    { id: boardB.boardId, title: 'Sprint 12 — Delivery' },
    { id: boardC.boardId, title: 'Mobile App — Beta' },
    { id: boardD.boardId, title: 'Bugs & Hotfixes' },
  ];
  for (const b of boards) {
    const snapshot = await recalculateBoardState(b.id);
    const m = snapshot?.metrics;
    const signalCount = snapshot?.signals.length ?? 0;
    if (m) {
      console.log(
        `  ✅ ${b.title} — ${m.doneTasks}/${m.totalTasks} done (${m.completionRate}%), ` +
        `${m.overdueTasks} en retard, ${m.unassignedTasks} non assignées, ${signalCount} signaux`,
      );
    }
  }

  console.log('\n✅ Seed terminé avec succès !');
  console.log('\n📊 Résumé :');
  console.log('  - 5 utilisateurs (admin, manager, dev1, dev2, dev3)');
  console.log('  - 1 team avec 3 développeurs');
  console.log('  - 3 projets (active, on_hold, archived)');
  console.log('  - 4 boards rattachés à la team, ~23 tâches au total');
  console.log('  - Signaux générés : overdue, deadline_risk, unassigned_high_complexity');
  console.log('  - Métriques pré-calculées (board_metrics) pour le dashboard');
  console.log('\n🔑 Comptes demo (mot de passe : demo1234) :');
  console.log('  admin@nibras.demo    → admin');
  console.log('  manager@nibras.demo  → manager');
  console.log('  dev1@nibras.demo     → developer');
  console.log('  dev2@nibras.demo     → developer');
  console.log('  dev3@nibras.demo     → developer');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
