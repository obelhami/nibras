import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { hasPermission } from '../lib/permissions';

type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string | null;
};

type BoardRow = {
  id: string;
  title: string;
  source: string;
  linked_project: string | null;
  linked_project_name: string | null;
  visibility: string;
  team_id: string | null;
  owner_email: string;
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
  assignee_email: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

const DEFAULT_COLUMNS = ['Todo', 'Doing', 'Review', 'Done'];
const VISIBILITIES = new Set(['private', 'team', 'public']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function slugifyColumnName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'column';
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getCurrentUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);

  if (!payload || payload.purpose === 'verification') {
    return null;
  }

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const row = result.rows[0] as { id: number | string; username: string; email: string; role: string | null } | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
    role: row.role ?? (typeof payload.role === 'string' ? payload.role : null),
  };
}

async function getBoard(boardId: string) {
  const result = await db.execute({
    sql: `
      SELECT boards.*, projects.name AS linked_project_name
      FROM boards
      LEFT JOIN projects ON projects.id = boards.linked_project
      WHERE boards.id = ?
    `,
    args: [boardId],
  });

  return result.rows[0] as BoardRow | undefined;
}

async function getProjectById(projectId: string) {
  const result = await db.execute({
    sql: 'SELECT id, name FROM projects WHERE id = ?',
    args: [projectId],
  });

  return result.rows[0] as { id: string; name: string } | undefined;
}

async function getBoardColumns(boardId: string) {
  const result = await db.execute({
    sql: 'SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC, created_at ASC',
    args: [boardId],
  });

  return result.rows as unknown as ColumnRow[];
}

async function getBoardTasks(boardId: string) {
  const result = await db.execute({
    sql: `
      SELECT
        tasks.*,
        board_columns.name AS column_name,
        board_columns.slug AS column_slug,
        board_columns.position AS column_position
      FROM tasks
      JOIN board_columns ON board_columns.id = tasks.column_id
      WHERE tasks.board_id = ?
      ORDER BY board_columns.position ASC, tasks.created_at ASC
    `,
    args: [boardId],
  });

  return result.rows as unknown as Array<TaskRow & { column_name: string; column_slug: string; column_position: number }>;
}

async function userHasTeamAccess(board: BoardRow, userId: string) {
  if (!board.team_id) {
    return false;
  }

  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [board.team_id, userId],
  });

  return result.rows.length > 0;
}

async function canAccessBoard(board: BoardRow, user: AuthUser) {
  if (board.owner_email === user.email || user.role === 'admin' || user.role === 'manager') {
    return true;
  }

  if (board.visibility === 'public') {
    return true;
  }

  return userHasTeamAccess(board, user.id);
}

async function canManageBoard(board: BoardRow, user: AuthUser) {
  if (board.owner_email === user.email) {
    return true;
  }

  return hasPermission(user.role, 'create_board');
}

async function getAccessibleBoard(boardId: string, user: AuthUser) {
  const board = await getBoard(boardId);
  if (!board) {
    return { error: 'Board not found', status: 404 as const };
  }

  const allowed = await canAccessBoard(board, user);
  if (!allowed) {
    return { error: 'Forbidden', status: 403 as const };
  }

  return { board };
}

async function getManageableBoard(boardId: string, user: AuthUser) {
  const board = await getBoard(boardId);
  if (!board) {
    return { error: 'Board not found', status: 404 as const };
  }

  const allowed = await canManageBoard(board, user);
  if (!allowed) {
    return { error: 'Forbidden', status: 403 as const };
  }

  return { board };
}

async function recalculateBoardState(boardId: string) {
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const columns = await getBoardColumns(boardId);
  const tasks = await getBoardTasks(boardId);

  const columnStats = columns.map((column) => ({
    id: column.id,
    name: column.name,
    slug: column.slug,
    position: column.position,
    taskCount: tasks.filter((task) => task.column_id === column.id).length,
  }));

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((task) => task.status_slug === 'done').length;
  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status_slug === 'done') {
      return false;
    }

    return new Date(task.due_date).getTime() < Date.now();
  }).length;
  const unassignedTasks = tasks.filter((task) => !task.assignee_email).length;
  const averageComplexity = tasks.length === 0
    ? 0
    : Number((tasks.reduce((sum, task) => sum + (task.complexity ?? 0), 0) / tasks.length).toFixed(2));

  const signals: Array<{
    taskId: string;
    signalType: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
  }> = [];

  for (const task of tasks) {
    const details: Record<string, unknown> = {
      taskId: task.id,
      status: task.status_slug,
      columnId: task.column_id,
    };

    if (!task.assignee_email && (task.complexity ?? 0) >= 4) {
      signals.push({
        taskId: task.id,
        signalType: 'unassigned_high_complexity',
        severity: 'high',
        message: `Task "${task.title}" is unassigned and high complexity`,
        details,
      });
    }

    if (task.due_date) {
      const dueDate = new Date(task.due_date).getTime();
      const diffInDays = (dueDate - Date.now()) / (1000 * 60 * 60 * 24);

      if (task.status_slug !== 'done' && diffInDays < 0) {
        signals.push({
          taskId: task.id,
          signalType: 'overdue',
          severity: 'critical',
          message: `Task "${task.title}" is overdue`,
          details,
        });
      } else if (task.status_slug !== 'done' && diffInDays <= 2) {
        signals.push({
          taskId: task.id,
          signalType: 'deadline_risk',
          severity: 'medium',
          message: `Task "${task.title}" is due soon`,
          details,
        });
      }
    }
  }

  const metricsPayload = {
    boardId,
    title: board.title,
    totalTasks,
    doneTasks,
    completionRate: totalTasks === 0 ? 0 : Number(((doneTasks / totalTasks) * 100).toFixed(2)),
    overdueTasks,
    unassignedTasks,
    averageComplexity,
    byColumn: columnStats,
    generatedAt: new Date().toISOString(),
  };

  await db.execute({
    sql: 'DELETE FROM task_signals WHERE board_id = ?',
    args: [boardId],
  });

  for (const signal of signals) {
    await db.execute({
      sql: `
        INSERT INTO task_signals (id, board_id, task_id, signal_type, severity, message, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        boardId,
        signal.taskId,
        signal.signalType,
        signal.severity,
        signal.message,
        JSON.stringify(signal.details),
      ],
    });
  }

  await db.execute({
    sql: `
      INSERT INTO board_metrics (board_id, payload, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(board_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [boardId, JSON.stringify(metricsPayload)],
  });

  return {
    metrics: metricsPayload,
    signals,
  };
}

export default new Elysia()
  .get('/boards', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const result = await db.execute({
      sql: `
        SELECT DISTINCT boards.*, projects.name AS linked_project_name
        FROM boards
        LEFT JOIN team_members ON team_members.team_id = boards.team_id AND team_members.user_id = ?
        LEFT JOIN projects ON projects.id = boards.linked_project
        WHERE boards.owner_email = ?
          OR boards.visibility = 'public'
          OR team_members.user_id IS NOT NULL
        ORDER BY boards.updated_at DESC, boards.created_at DESC
      `,
      args: [user.id, user.email],
    });

    const boards = result.rows as unknown as BoardRow[];
    const enrichedBoards = [] as Array<BoardRow & { columns: ColumnRow[]; taskCount: number }>;

    for (const board of boards) {
      const columns = await getBoardColumns(board.id);
      const taskCountResult = await db.execute({
        sql: 'SELECT COUNT(*) AS count FROM tasks WHERE board_id = ?',
        args: [board.id],
      });

      const taskCountRow = taskCountResult.rows[0] as { count: number | string } | undefined;

      enrichedBoards.push({
        ...board,
        columns,
        taskCount: Number(taskCountRow?.count ?? 0),
      });
    }

    return { boards: enrichedBoards };
  })

  .post('/boards', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!hasPermission(user.role, 'create_board')) {
      set.status = 403;
      return { message: 'You do not have permission to create boards' };
    }

    const title = normalizeText(body.title);
    if (!title) {
      set.status = 400;
      return { message: 'Board title is required' };
    }

    const visibility = normalizeText(body.visibility) || 'private';
    if (!VISIBILITIES.has(visibility)) {
      set.status = 400;
      return { message: 'Visibility must be private, team, or public' };
    }

    const source = normalizeText(body.source) || 'manual';
    const linkedProject = normalizeText(body.linkedProject) || null;
    const teamId = normalizeText(body.teamId) || null;

    let linkedProjectName: string | null = null;
    if (linkedProject) {
      const project = await getProjectById(linkedProject);
      if (!project) {
        set.status = 404;
        return { message: 'Linked project not found' };
      }
      linkedProjectName = project.name;
    }

    if (teamId) {
      const teamResult = await db.execute({
        sql: 'SELECT id, manager_id FROM teams WHERE id = ?',
        args: [teamId],
      });

      const teamRow = teamResult.rows[0] as { id: string; manager_id: string } | undefined;
      if (!teamRow) {
        set.status = 404;
        return { message: 'Team not found' };
      }

      if (teamRow.manager_id !== user.id && user.role !== 'admin') {
        set.status = 403;
        return { message: 'Only the team manager or admin can attach a team board' };
      }
    }

    const boardId = crypto.randomUUID();
    await db.execute({
      sql: `
        INSERT INTO boards (id, title, source, linked_project, visibility, team_id, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [boardId, title, source, linkedProject, visibility, teamId, user.email],
    });

    const requestedColumns = Array.isArray(body.columns) && body.columns.length > 0
      ? body.columns
      : DEFAULT_COLUMNS;

    const normalizedColumns = [] as Array<{ name: string; slug: string }>;
    const seenSlugs = new Set<string>();

    for (const rawColumn of requestedColumns) {
      const name = normalizeText(rawColumn);
      if (!name) {
        continue;
      }

      const slug = slugifyColumnName(name);
      if (seenSlugs.has(slug)) {
        continue;
      }

      seenSlugs.add(slug);
      normalizedColumns.push({ name, slug });
    }

    if (normalizedColumns.length === 0) {
      normalizedColumns.push(...DEFAULT_COLUMNS.map((name) => ({ name, slug: slugifyColumnName(name) })));
    }

    const createdColumns = [] as ColumnRow[];

    for (let index = 0; index < normalizedColumns.length; index += 1) {
      const column = normalizedColumns[index]!;
      const columnId = crypto.randomUUID();

      await db.execute({
        sql: `
          INSERT INTO board_columns (id, board_id, name, slug, position)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [columnId, boardId, column.name, column.slug, index],
      });

      createdColumns.push({
        id: columnId,
        board_id: boardId,
        name: column.name,
        slug: column.slug,
        position: index,
      });
    }

    const snapshot = await recalculateBoardState(boardId);

    return {
      message: 'Board created successfully',
      board: {
        id: boardId,
        title,
        source,
        linkedProject,
        linkedProjectName,
        visibility,
        teamId,
        ownerEmail: user.email,
      },
      columns: createdColumns,
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.String(),
      source: t.Optional(t.String()),
      linkedProject: t.Optional(t.String()),
      visibility: t.Optional(t.String()),
      teamId: t.Optional(t.String()),
      columns: t.Optional(t.Array(t.String())),
    }),
  })

  .get('/boards/:boardId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const columns = await getBoardColumns(params.boardId);
    const tasks = await getBoardTasks(params.boardId);
    const metricsResult = await db.execute({
      sql: 'SELECT payload FROM board_metrics WHERE board_id = ?',
      args: [params.boardId],
    });
    const metricsRow = metricsResult.rows[0] as { payload: string } | undefined;
    const signalsResult = await db.execute({
      sql: 'SELECT * FROM task_signals WHERE board_id = ? ORDER BY created_at DESC',
      args: [params.boardId],
    });

    return {
      board: boardAccess.board,
      columns,
      tasks,
      metrics: metricsRow?.payload ? JSON.parse(metricsRow.payload) : null,
      signals: signalsResult.rows,
    };
  })

  .patch('/boards/:boardId', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const updates: string[] = [];
    const values: Array<string | null> = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        set.status = 400;
        return { message: 'Board title cannot be empty' };
      }

      updates.push('title = ?');
      values.push(title);
    }

    if (typeof body.source === 'string') {
      updates.push('source = ?');
      values.push(body.source.trim() || 'manual');
    }

    if (typeof body.linkedProject === 'string') {
      const linkedProject = body.linkedProject.trim() || null;
      if (linkedProject) {
        const project = await getProjectById(linkedProject);
        if (!project) {
          set.status = 404;
          return { message: 'Linked project not found' };
        }
      }

      updates.push('linked_project = ?');
      values.push(linkedProject);
    }

    if (typeof body.visibility === 'string') {
      const visibility = body.visibility.trim();
      if (!VISIBILITIES.has(visibility)) {
        set.status = 400;
        return { message: 'Visibility must be private, team, or public' };
      }

      updates.push('visibility = ?');
      values.push(visibility);
    }

    if (typeof body.teamId === 'string') {
      const teamId = body.teamId.trim() || null;
      if (teamId) {
        const teamResult = await db.execute({
          sql: 'SELECT id, manager_id FROM teams WHERE id = ?',
          args: [teamId],
        });

        const teamRow = teamResult.rows[0] as { id: string; manager_id: string } | undefined;
        if (!teamRow) {
          set.status = 404;
          return { message: 'Team not found' };
        }

        if (teamRow.manager_id !== user.id && user.role !== 'admin') {
          set.status = 403;
          return { message: 'Only the team manager or admin can attach a team board' };
        }
      }

      updates.push('team_id = ?');
      values.push(teamId);
    }

    if (updates.length === 0) {
      set.status = 400;
      return { message: 'No board changes provided' };
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await db.execute({
      sql: `UPDATE boards SET ${updates.join(', ')} WHERE id = ?`,
      args: [...values, params.boardId],
    });

    const snapshot = await recalculateBoardState(params.boardId);

    return {
      message: 'Board updated successfully',
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      source: t.Optional(t.String()),
      linkedProject: t.Optional(t.String()),
      visibility: t.Optional(t.String()),
      teamId: t.Optional(t.String()),
    }),
  })

  .delete('/boards/:boardId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    await db.execute({ sql: 'DELETE FROM task_signals WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM board_metrics WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM task_history WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM tasks WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM board_columns WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM boards WHERE id = ?', args: [params.boardId] });

    return { message: 'Board deleted successfully' };
  })

  .get('/boards/:boardId/metrics', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const snapshot = await recalculateBoardState(params.boardId);
    return {
      metrics: snapshot?.metrics ?? null,
      signals: snapshot?.signals ?? [],
    };
  })

  .post('/boards/:boardId/columns', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const name = normalizeText(body.name);
    if (!name) {
      set.status = 400;
      return { message: 'Column name is required' };
    }

    const slug = slugifyColumnName(name);
    const existing = await db.execute({
      sql: 'SELECT id FROM board_columns WHERE board_id = ? AND slug = ?',
      args: [params.boardId, slug],
    });

    if (existing.rows.length > 0) {
      set.status = 409;
      return { message: 'Column already exists on this board' };
    }

    const positionResult = await db.execute({
      sql: 'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM board_columns WHERE board_id = ?',
      args: [params.boardId],
    });
    const positionRow = positionResult.rows[0] as { next_position: number | string } | undefined;
    const position = Number(positionRow?.next_position ?? 0);
    const columnId = crypto.randomUUID();

    await db.execute({
      sql: 'INSERT INTO board_columns (id, board_id, name, slug, position) VALUES (?, ?, ?, ?, ?)',
      args: [columnId, params.boardId, name, slug, position],
    });

    await recalculateBoardState(params.boardId);

    return {
      message: 'Column created successfully',
      column: { id: columnId, boardId: params.boardId, name, slug, position },
    };
  }, {
    body: t.Object({ name: t.String() }),
  })

  .patch('/boards/:boardId/columns/:columnId', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const columnResult = await db.execute({
      sql: 'SELECT * FROM board_columns WHERE id = ? AND board_id = ?',
      args: [params.columnId, params.boardId],
    });
    const column = columnResult.rows[0] as ColumnRow | undefined;

    if (!column) {
      set.status = 404;
      return { message: 'Column not found' };
    }

    const updates: string[] = [];
    const values: Array<string | number> = [];

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { message: 'Column name cannot be empty' };
      }

      const slug = slugifyColumnName(name);
      const duplicateResult = await db.execute({
        sql: 'SELECT id FROM board_columns WHERE board_id = ? AND slug = ? AND id <> ?',
        args: [params.boardId, slug, params.columnId],
      });

      if (duplicateResult.rows.length > 0) {
        set.status = 409;
        return { message: 'Another column already uses that name' };
      }

      updates.push('name = ?', 'slug = ?');
      values.push(name, slug);
    }

    if (typeof body.position === 'number') {
      updates.push('position = ?');
      values.push(body.position);
    }

    if (updates.length === 0) {
      set.status = 400;
      return { message: 'No column changes provided' };
    }

    await db.execute({
      sql: `UPDATE board_columns SET ${updates.join(', ')} WHERE id = ? AND board_id = ?`,
      args: [...values, params.columnId, params.boardId],
    });

    await recalculateBoardState(params.boardId);

    return {
      message: 'Column updated successfully',
    };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      position: t.Optional(t.Number()),
    }),
  })

  .delete('/boards/:boardId/columns/:columnId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const taskResult = await db.execute({
      sql: 'SELECT id FROM tasks WHERE column_id = ? LIMIT 1',
      args: [params.columnId],
    });

    if (taskResult.rows.length > 0) {
      set.status = 409;
      return { message: 'Move or delete tasks before removing this column' };
    }

    await db.execute({
      sql: 'DELETE FROM board_columns WHERE id = ? AND board_id = ?',
      args: [params.columnId, params.boardId],
    });

    await recalculateBoardState(params.boardId);

    return { message: 'Column deleted successfully' };
  })

  .get('/boards/:boardId/tasks', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const tasks = await getBoardTasks(params.boardId);
    return { tasks };
  })

  .post('/boards/:boardId/tasks', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    if (!hasPermission(user.role, 'create_task') && boardAccess.board.owner_email !== user.email) {
      set.status = 403;
      return { message: 'You do not have permission to create tasks' };
    }

    const title = normalizeText(body.title);
    if (!title) {
      set.status = 400;
      return { message: 'Task title is required' };
    }

    const columns = await getBoardColumns(params.boardId);
    if (columns.length === 0) {
      set.status = 400;
      return { message: 'The board has no columns yet' };
    }

    const selectedColumn = typeof body.columnId === 'string'
      ? columns.find((column) => column.id === body.columnId)
      : columns[0];

    if (!selectedColumn) {
      set.status = 404;
      return { message: 'Target column not found' };
    }

    const priority = typeof body.priority === 'string' && PRIORITIES.has(body.priority)
      ? body.priority
      : 'medium';

    const complexity = typeof body.complexity === 'number'
      ? body.complexity
      : null;

    if (complexity !== null && (complexity < 1 || complexity > 5)) {
      set.status = 400;
      return { message: 'Complexity must be between 1 and 5' };
    }

    const taskId = crypto.randomUUID();
    const description = normalizeText(body.description) || null;
    const assigneeEmail = normalizeText(body.assigneeEmail) || null;
    const dueDate = normalizeText(body.dueDate) || null;

    await db.execute({
      sql: `
        INSERT INTO tasks (
          id, board_id, column_id, title, description, priority,
          status_slug, due_date, complexity, assignee_email, created_by_email, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        taskId,
        params.boardId,
        selectedColumn.id,
        title,
        description,
        priority,
        selectedColumn.slug,
        dueDate,
        complexity,
        assigneeEmail,
        user.email,
      ],
    });

    await db.execute({
      sql: `
        INSERT INTO task_history (id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        taskId,
        params.boardId,
        null,
        selectedColumn.id,
        null,
        selectedColumn.slug,
        user.email,
        'Task created',
      ],
    });

    const snapshot = await recalculateBoardState(params.boardId);

    return {
      message: 'Task created successfully',
      task: {
        id: taskId,
        boardId: params.boardId,
        columnId: selectedColumn.id,
        title,
        description,
        priority,
        status: selectedColumn.slug,
        dueDate,
        complexity,
        assigneeEmail,
        createdByEmail: user.email,
      },
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      dueDate: t.Optional(t.String()),
      complexity: t.Optional(t.Number()),
      assigneeEmail: t.Optional(t.String()),
      columnId: t.Optional(t.String()),
    }),
  })

  .patch('/boards/:boardId/tasks/:taskId', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as TaskRow | undefined;

    if (!task) {
      set.status = 404;
      return { message: 'Task not found' };
    }

    const updates: string[] = [];
    const values: Array<string | number | null> = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        set.status = 400;
        return { message: 'Task title cannot be empty' };
      }

      updates.push('title = ?');
      values.push(title);
    }

    if (typeof body.description === 'string') {
      updates.push('description = ?');
      values.push(body.description.trim() || null);
    }

    if (typeof body.priority === 'string') {
      const priority = body.priority.trim();
      if (!PRIORITIES.has(priority)) {
        set.status = 400;
        return { message: 'Priority must be low, medium, high, or urgent' };
      }

      updates.push('priority = ?');
      values.push(priority);
    }

    if (typeof body.dueDate === 'string') {
      updates.push('due_date = ?');
      values.push(body.dueDate.trim() || null);
    }

    if (typeof body.complexity === 'number') {
      if (body.complexity < 1 || body.complexity > 5) {
        set.status = 400;
        return { message: 'Complexity must be between 1 and 5' };
      }

      updates.push('complexity = ?');
      values.push(body.complexity);
    }

    if (typeof body.assigneeEmail === 'string') {
      updates.push('assignee_email = ?');
      values.push(body.assigneeEmail.trim() || null);
    }

    if (updates.length === 0) {
      set.status = 400;
      return { message: 'No task changes provided' };
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await db.execute({
      sql: `UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND board_id = ?`,
      args: [...values, params.taskId, params.boardId],
    });

    const snapshot = await recalculateBoardState(params.boardId);

    return {
      message: 'Task updated successfully',
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      dueDate: t.Optional(t.String()),
      complexity: t.Optional(t.Number()),
      assigneeEmail: t.Optional(t.String()),
    }),
  })

  .post('/boards/:boardId/tasks/:taskId/move', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const taskResult = await db.execute({
      sql: 'SELECT * FROM tasks WHERE id = ? AND board_id = ?',
      args: [params.taskId, params.boardId],
    });
    const task = taskResult.rows[0] as TaskRow | undefined;

    if (!task) {
      set.status = 404;
      return { message: 'Task not found' };
    }

    const targetColumnResult = await db.execute({
      sql: 'SELECT * FROM board_columns WHERE id = ? AND board_id = ?',
      args: [body.toColumnId, params.boardId],
    });
    const targetColumn = targetColumnResult.rows[0] as ColumnRow | undefined;

    if (!targetColumn) {
      set.status = 404;
      return { message: 'Target column not found' };
    }

    const sourceColumnResult = await db.execute({
      sql: 'SELECT * FROM board_columns WHERE id = ? AND board_id = ?',
      args: [task.column_id, params.boardId],
    });
    const sourceColumn = sourceColumnResult.rows[0] as ColumnRow | undefined;

    await db.execute({
      sql: `
        UPDATE tasks
        SET column_id = ?, status_slug = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND board_id = ?
      `,
      args: [targetColumn.id, targetColumn.slug, params.taskId, params.boardId],
    });

    await db.execute({
      sql: `
        INSERT INTO task_history (
          id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        params.taskId,
        params.boardId,
        sourceColumn?.id ?? task.column_id,
        targetColumn.id,
        sourceColumn?.slug ?? task.status_slug,
        targetColumn.slug,
        user.email,
        normalizeText(body.note) || null,
      ],
    });

    const snapshot = await recalculateBoardState(params.boardId);

    return {
      message: 'Task moved successfully',
      task: {
        id: params.taskId,
        fromColumnId: sourceColumn?.id ?? task.column_id,
        toColumnId: targetColumn.id,
        status: targetColumn.slug,
      },
      metrics: snapshot?.metrics ?? null,
      signals: snapshot?.signals ?? [],
    };
  }, {
    body: t.Object({
      toColumnId: t.String(),
      note: t.Optional(t.String()),
    }),
  })

  .get('/boards/:boardId/tasks/:taskId/history', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const result = await db.execute({
      sql: 'SELECT * FROM task_history WHERE board_id = ? AND task_id = ? ORDER BY created_at DESC',
      args: [params.boardId, params.taskId],
    });

    return { history: result.rows };
  });