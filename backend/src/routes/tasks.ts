import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { validationError, notFound, forbidden, unauthorized, conflict, internalError } from '../lib/errors';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { normalizeText, isValidDateString } from '../lib/validation';

// Priorités valides — identiques à board.ts (Hamza) pour cohérence.
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string | null;
};

type TaskRow = {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: string;
  status_slug: string;
  due_date: string | null;
  complexity: number | null;
  risk_score: number | null;
  assignee_email: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

type ColumnRow = {
  id: string;
  board_id: string;
  name: string;
  slug: string;
  position: number;
};


// JWT puis charge l'utilisateur depuis la base pour avoir le rôle à jour.
async function getCurrentUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);
  if (!payload || payload.purpose === 'verification') return null;

  const result = payload.userId
    ? await db.execute({
        sql: 'SELECT id, username, email, role FROM users WHERE id = ?',
        args: [payload.userId],
      })
    : await db.execute({
        sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
        args: [payload.email],
      });

  const row = result.rows[0] as { id: number | string; username: string; email: string; role: string | null } | undefined;
  if (!row) return null;

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
    role: row.role ?? (typeof payload.role === 'string' ? payload.role : null),
  };
}

// Vérifie qu'un board existe et que l'utilisateur y a accès,
// nécessaire pour ne pas créer de couplage.
async function getBoard(boardId: string, user: AuthUser) {
  const result = await db.execute({
    sql: `SELECT boards.*, projects.name AS linked_project_name
          FROM boards
          LEFT JOIN projects ON projects.id = boards.linked_project
          WHERE boards.id = ?`,
    args: [boardId],
  });

  const board = result.rows[0] as (typeof result.rows[0] & {
    id: string; owner_email: string; visibility: string; team_id: string | null;
  }) | undefined;

  if (!board) return null;

  // Gouvernance : l'admin a toujours accès, quelle que soit la visibilité
  // du board (CDC §27 "Security, ethics and access management").
  if (user.role === 'admin') return board;

  if (board.owner_email === user.email) return board;

  // BR-07 : "A Manager only sees teams or projects under responsibility."
  // Un manager n'a accès qu'aux boards des équipes qu'il dirige.
  if (user.role === 'manager') {
    const manages = await isManagerOfTeam(board.team_id, user.id);
    return manages ? board : null;
  }

  if (board.visibility === 'private' && board.owner_email !== user.email) return null;

  if (board.visibility === 'team' && board.team_id) {
    const member = await db.execute({
      sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
      args: [board.team_id, user.id],
    });
    if (member.rows.length === 0 && board.owner_email !== user.email) return null;
  }

  return board;
}

// BR-07 : "A Manager only sees teams or projects under responsibility."
// Un manager n'a un droit de gestion (assignation, suppression) que sur les
// boards des équipes qu'il dirige (teams.manager_id), pas sur tous les boards.
async function isManagerOfTeam(teamId: string | null | undefined, userId: string): Promise<boolean> {
  if (!teamId) return false;
  const result = await db.execute({
    sql: 'SELECT 1 FROM teams WHERE id = ? AND manager_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

// Helpers assignees
async function getTaskAssignees(taskId: string): Promise<string[]> {
  const result = await db.execute({
    sql: 'SELECT user_email FROM task_assignees WHERE task_id = ? ORDER BY assigned_at ASC',
    args: [taskId],
  });
  return (result.rows as unknown as Array<{ user_email: string }>).map((r) => r.user_email);
}

async function getAssigneesForTasks(taskIds: string[]): Promise<Record<string, string[]>> {
  if (taskIds.length === 0) return {};
  const placeholders = taskIds.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `SELECT task_id, user_email FROM task_assignees WHERE task_id IN (${placeholders}) ORDER BY assigned_at ASC`,
    args: taskIds,
  });
  const grouped: Record<string, string[]> = {};
  for (const row of result.rows as unknown as Array<{ task_id: string; user_email: string }>) {
    const existing = grouped[row.task_id];
    if (!existing) {
      grouped[row.task_id] = [row.user_email];
    } else {
      existing.push(row.user_email);
    }
  }
  return grouped;
}

export default new Elysia()
  // ── GET /boards/:boardId/tasks — Pagination and filters (P0) ──────────
  .get('/boards/:boardId/tasks', async ({ headers, params, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    // Pagination
    const { page, limit, offset } = parsePagination(query);

    // Filters
    const conditions = ['t.board_id = ?'];
    const args: Array<string | number> = [params.boardId];

    if (query.status) {
      conditions.push('t.status_slug = ?');
      args.push(query.status);
    }

    if (query.priority) {
      if (!PRIORITIES.has(query.priority)) {
        return validationError(set, `priority must be one of: ${Array.from(PRIORITIES).join(', ')}`);
      }
      conditions.push('t.priority = ?');
      args.push(query.priority);
    }

    if (query.assigneeId) {
      const assigneeResult = await db.execute({
        sql: 'SELECT email FROM users WHERE id = ?',
        args: [query.assigneeId],
      });
      const assigneeUser = assigneeResult.rows[0] as unknown as { email: string } | undefined;
      if (!assigneeUser) return notFound(set, 'Assignee user not found');
      conditions.push('t.assignee_email = ?');
      args.push(assigneeUser.email);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM tasks t ${whereClause}`,
      args,
    });
    const total = Number((countResult.rows[0] as unknown as { total: number | string }).total ?? 0);

    const listResult = await db.execute({
      sql: `
        SELECT t.*, bc.name AS column_name, bc.slug AS column_slug, bc.position AS column_position
        FROM tasks t
        JOIN board_columns bc ON bc.id = t.column_id
        ${whereClause}
        ORDER BY bc.position ASC, t.created_at ASC
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    });

    const tasks = listResult.rows as unknown as TaskRow[];
    const assigneesByTask = await getAssigneesForTasks(tasks.map((task) => task.id));

    return {
      tasks: tasks.map((task) => ({
        ...task,
        riskScore: task.risk_score,
        // assignees = multi-assignees + fallback sur assignee_email legacy
        assignees: assigneesByTask[task.id] ?? (task.assignee_email ? [task.assignee_email] : []),
      })),
      pagination: buildPaginationMeta(page, limit, total),
    };
  })

  // ── POST /boards/:boardId/tasks/:taskId/assignees — Add assignee (P0) ──
  // Assignation à plusieurs utilisateurs : complète le champ unique
  .post('/boards/:boardId/tasks/:taskId/assignees', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as unknown as TaskRow | undefined;
    if (!task) return notFound(set, 'Task not found');

    // Module 2 — CDC §9: "Assign task" = No (Developer) / Yes (Manager, Admin).
    // Board owners keep the right on their own board; managers only within
    // their own team (BR-07).
    const isOwner = (board as { owner_email: string }).owner_email === user.email;
    const isScopedManager = user.role === 'manager'
      && (await isManagerOfTeam((board as { team_id: string | null }).team_id, user.id));
    const canAssign = isOwner || isScopedManager || user.role === 'admin';
    if (!canAssign) return forbidden(set, 'You do not have permission to assign this task');

    const userId = normalizeText(body.userId);
    if (!userId) return validationError(set, 'userId is required');


    const userResult = await db.execute({
      sql: 'SELECT id, email FROM users WHERE id = ?',
      args: [userId],
    });
    const targetUser = userResult.rows[0] as unknown as { id: number | string; email: string } | undefined;
    if (!targetUser) return notFound(set, 'User not found');

    try {
      await db.execute({
        sql: `INSERT INTO task_assignees (task_id, user_email) VALUES (?, ?)
              ON CONFLICT(task_id, user_email) DO NOTHING`,
        args: [task.id, targetUser.email],
      });
    } catch (error: any) {
      return internalError(set);
    }

    if (!task.assignee_email) {
      await db.execute({
        sql: 'UPDATE tasks SET assignee_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [targetUser.email, task.id],
      });
    }

    const assignees = await getTaskAssignees(task.id);
    return { message: 'Assignee added successfully', assignees };
  }, {
    body: t.Object({ userId: t.String() }),
  })

  // ── DELETE /boards/:boardId/tasks/:taskId/assignees/:userId ──────────────
  // Remove assignee par userId
  .delete('/boards/:boardId/tasks/:taskId/assignees/:userId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as unknown as TaskRow | undefined;
    if (!task) return notFound(set, 'Task not found');

    const isOwner = (board as { owner_email: string }).owner_email === user.email;
    const isScopedManager = user.role === 'manager'
      && (await isManagerOfTeam((board as { team_id: string | null }).team_id, user.id));
    const canAssign = isOwner || isScopedManager || user.role === 'admin';
    if (!canAssign) return forbidden(set, 'You do not have permission to modify task assignment');

    const userResult = await db.execute({
      sql: 'SELECT id, email FROM users WHERE id = ?',
      args: [params.userId],
    });
    const targetUser = userResult.rows[0] as unknown as { id: number | string; email: string } | undefined;
    if (!targetUser) return notFound(set, 'User not found');

    await db.execute({
      sql: 'DELETE FROM task_assignees WHERE task_id = ? AND user_email = ?',
      args: [task.id, targetUser.email],
    });

    // Si on retire le primary assignee, on met à jour le champ legacy.
    if (task.assignee_email === targetUser.email) {
      const remaining = await getTaskAssignees(task.id);
      await db.execute({
        sql: 'UPDATE tasks SET assignee_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [remaining[0] ?? null, task.id],
      });
    }

    const assignees = await getTaskAssignees(task.id);
    return { message: 'Assignee removed successfully', assignees };
  })

  // ── PATCH /boards/:boardId/tasks/:taskId/riskScore — riskScore (P0) ────
  .patch('/boards/:boardId/tasks/:taskId/riskScore', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT id FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    if (taskResult.rows.length === 0) return notFound(set, 'Task not found');

    const { riskScore } = body;
    if (riskScore !== null && (riskScore < 0 || riskScore > 100)) {
      return validationError(set, 'riskScore must be between 0 and 100, or null to reset');
    }

    await db.execute({
      sql: 'UPDATE tasks SET risk_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND board_id = ?',
      args: [riskScore, params.taskId, params.boardId],
    });

    return { message: 'riskScore updated successfully', riskScore };
  }, {
    body: t.Object({ riskScore: t.Union([t.Number(), t.Null()]) }),
  })

  // ── POST /boards/:boardId/tasks/:taskId/comments — Add comment (P0) ────
  // "Backend comment if missing" : table task_comments créée par migrations.ts.
  .post('/boards/:boardId/tasks/:taskId/comments', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT id FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    if (taskResult.rows.length === 0) return notFound(set, 'Task not found');

    const content = normalizeText(body.content);
    if (!content) return validationError(set, 'Comment content is required');

    const commentId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO task_comments (id, task_id, board_id, author_email, content)
            VALUES (?, ?, ?, ?, ?)`,
      args: [commentId, params.taskId, params.boardId, user.email, content],
    });

    return {
      message: 'Comment added successfully',
      comment: { id: commentId, taskId: params.taskId, authorEmail: user.email, content },
    };
  }, {
    body: t.Object({ content: t.String() }),
  })

  // ── GET /boards/:boardId/tasks/:taskId/comments — List comments ─────────
  .get('/boards/:boardId/tasks/:taskId/comments', async ({ headers, params, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT id FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    if (taskResult.rows.length === 0) return notFound(set, 'Task not found');

    const { page, limit, offset } = parsePagination(query);

    const countResult = await db.execute({
      sql: 'SELECT COUNT(*) as total FROM task_comments WHERE task_id = ?',
      args: [params.taskId],
    });
    const total = Number((countResult.rows[0] as unknown as { total: number | string }).total ?? 0);

    const listResult = await db.execute({
      sql: `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [params.taskId, limit, offset],
    });

    return { comments: listResult.rows, pagination: buildPaginationMeta(page, limit, total) };
  })

  // ── POST /boards/:boardId/tasks/:taskId/close — Close with validation ──
  // "Move / close task with business validation" (P0) :
  // BR : une tâche non assignée ne peut pas être fermée (accountability).
  .post('/boards/:boardId/tasks/:taskId/close', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as unknown as TaskRow | undefined;
    if (!task) return notFound(set, 'Task not found');

    // Business validation 1 : déjà fermée
    if (task.status_slug === 'done') {
      return validationError(set, 'Task is already closed');
    }

    // Business validation 2 : doit être assignée (accountability, CDC BR)
    const assignees = await getTaskAssignees(task.id);
    if (!task.assignee_email && assignees.length === 0) {
      return validationError(set, 'Task must be assigned to at least one user before it can be closed');
    }

    // Trouver la colonne "done" (dernière colonne ou celle dont le slug = done)
    const columnsResult = await db.execute({
      sql: 'SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC',
      args: [params.boardId],
    });
    const columns = columnsResult.rows as unknown as ColumnRow[];
    const doneColumn = columns.find((col) => col.slug === 'done') ?? columns[columns.length - 1];

    if (!doneColumn) return internalError(set, 'Board has no terminal column');

    await db.execute({
      sql: `UPDATE tasks SET column_id = ?, status_slug = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND board_id = ?`,
      args: [doneColumn.id, doneColumn.slug, task.id, params.boardId],
    });

    // Historique (BR-03 du CDC : "Every status change must generate an entry in TaskHistory")
    await db.execute({
      sql: `INSERT INTO task_history
              (id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        task.id,
        params.boardId,
        task.column_id,
        doneColumn.id,
        task.status_slug,
        doneColumn.slug,
        user.email,
        (body as { note?: string })?.note ?? 'Task closed',
      ],
    });

    return {
      message: 'Task closed successfully',
      task: { id: task.id, status: doneColumn.slug, columnId: doneColumn.id },
    };
  }, {
    body: t.Optional(t.Object({ note: t.Optional(t.String()) })),
  })

  // ── DELETE /boards/:boardId/tasks/:taskId — Delete task ────────────────
  .delete('/boards/:boardId/tasks/:taskId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const board = await getBoard(params.boardId, user);
    if (!board) return notFound(set, 'Board not found or access denied');

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as unknown as TaskRow | undefined;
    if (!task) return notFound(set, 'Task not found');

    // Seul le créateur, le board owner, l'admin, ou le manager de l'équipe
    // du board (BR-07) peut supprimer.
    const isCreator = task.created_by_email === user.email;
    const isOwner = (board as { owner_email: string }).owner_email === user.email;
    const isScopedManager = user.role === 'manager'
      && (await isManagerOfTeam((board as { team_id: string | null }).team_id, user.id));
    const canDelete = isCreator || isOwner || isScopedManager || user.role === 'admin';
    if (!canDelete) return forbidden(set, 'You do not have permission to delete this task');

    await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [task.id] });

    return { message: 'Task deleted successfully' };
  });