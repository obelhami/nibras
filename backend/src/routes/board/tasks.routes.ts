import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../../db';
import { hasPermission } from '../../lib/permissions';
import { logAuditEvent } from '../../lib/audit';
import { clientIpFromHeaders } from '../../lib/rateLimit';
import { recalculateBoardState } from './metrics';
import {
  PRIORITIES,
  type ColumnRow,
  type TaskRow,
  getAccessibleBoard,
  getBoardColumns,
  getCurrentUser,
  normalizeText,
  resolveTeamMember,
} from './shared';

export default new Elysia()
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

    // A task must be assigned to a member of the board's team (by member id),
    // so KPIs (focus, workload) are accurate and scoped to the team.
    if (!boardAccess.board.team_id) {
      set.status = 400;
      return { message: 'This board has no team assigned; assign a team to the board first' };
    }

    const assigneeId = normalizeText(body.assigneeId);
    if (!assigneeId) {
      set.status = 400;
      return { message: 'A task must be assigned to at least one team member' };
    }

    const member = await resolveTeamMember(boardAccess.board.team_id, assigneeId);
    if (!member) {
      set.status = 403;
      return { message: "Assignee must be a member of the board's team" };
    }
    const assigneeEmail = member.email;

    const taskId = crypto.randomUUID();
    const description = normalizeText(body.description) || null;
    const dueDate = normalizeText(body.dueDate) || null;
    const isProactive = body.isProactive === true ? 1 : 0;

    await db.execute({
      sql: `
        INSERT INTO tasks (
          id, board_id, column_id, title, description, priority,
          status_slug, due_date, complexity, assignee_email, assignee_id, created_by_email, updated_at, is_proactive
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
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
        member.id,
        user.email,
        isProactive,
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

    await logAuditEvent({
      action: 'task_created',
      actorEmail: user.email,
      targetType: 'task',
      targetId: taskId,
      details: { title, boardId: params.boardId, priority },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
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
        assigneeId: member.id,
        assigneeEmail,
        createdByEmail: user.email,
        isProactive: Boolean(isProactive),
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
      assigneeId: t.Optional(t.String()),
      columnId: t.Optional(t.String()),
      isProactive: t.Optional(t.Boolean()),
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
    // Module 6 — CDC: track field-level edits (title/priority/dueDate/complexity)
    // that task_history previously only recorded for column moves.
    const fieldChanges: string[] = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        set.status = 400;
        return { message: 'Task title cannot be empty' };
      }

      if (title !== task.title) fieldChanges.push(`title: "${task.title}" -> "${title}"`);
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

      if (priority !== task.priority) fieldChanges.push(`priority: ${task.priority} -> ${priority}`);
      updates.push('priority = ?');
      values.push(priority);
    }

    if (typeof body.dueDate === 'string') {
      const dueDate = body.dueDate.trim() || null;
      if (dueDate !== task.due_date) fieldChanges.push(`dueDate: ${task.due_date ?? 'none'} -> ${dueDate ?? 'none'}`);
      updates.push('due_date = ?');
      values.push(dueDate);
    }

    if (typeof body.complexity === 'number') {
      if (body.complexity < 1 || body.complexity > 5) {
        set.status = 400;
        return { message: 'Complexity must be between 1 and 5' };
      }

      if (body.complexity !== task.complexity) fieldChanges.push(`complexity: ${task.complexity ?? 'none'} -> ${body.complexity}`);
      updates.push('complexity = ?');
      values.push(body.complexity);
    }

    if (typeof body.assigneeId === 'string') {
      const nextAssigneeId = body.assigneeId.trim();

      // A task must stay assigned to a member of the board's team.
      if (!nextAssigneeId) {
        set.status = 400;
        return { message: 'A task must be assigned to at least one team member' };
      }

      if (!boardAccess.board.team_id) {
        set.status = 400;
        return { message: 'This board has no team assigned; assign a team to the board first' };
      }

      const member = await resolveTeamMember(boardAccess.board.team_id, nextAssigneeId);
      if (!member) {
        set.status = 403;
        return { message: "Assignee must be a member of the board's team" };
      }

      // Log the change so the KPI Focus Score can measure reassignment.
      if (member.id !== task.assignee_id) {
        await db.execute({
          sql: `
            INSERT INTO task_assignment_history (id, task_id, board_id, from_email, to_email, changed_by_email)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          args: [
            crypto.randomUUID(),
            params.taskId,
            params.boardId,
            task.assignee_email,
            member.email,
            user.email,
          ],
        });
      }

      updates.push('assignee_id = ?', 'assignee_email = ?');
      values.push(member.id, member.email);
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

    if (fieldChanges.length > 0) {
      await db.execute({
        sql: `
          INSERT INTO task_history (id, task_id, board_id, from_column_id, to_column_id, from_status_slug, to_status_slug, moved_by_email, note)
          VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
        `,
        args: [crypto.randomUUID(), params.taskId, params.boardId, user.email, `Fields updated: ${fieldChanges.join('; ')}`],
      });

      await logAuditEvent({
        action: 'task_updated',
        actorEmail: user.email,
        targetType: 'task',
        targetId: params.taskId,
        details: { boardId: params.boardId, changes: fieldChanges },
        ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
      });
    }

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
      assigneeId: t.Optional(t.String()),
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

    // Module 2 — CDC §9: "Move task" = Own tasks only (Developer) / Yes (Manager, Admin).
    const isOwnTask = task.assignee_email === user.email || task.assignee_id === user.id;
    const canMoveAny = hasPermission(user.role, 'move_task') && user.role !== 'developer';
    if (!canMoveAny && !isOwnTask) {
      set.status = 403;
      return { message: 'You can only move tasks assigned to you' };
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

    await logAuditEvent({
      action: 'task_moved',
      actorEmail: user.email,
      targetType: 'task',
      targetId: params.taskId,
      details: {
        boardId: params.boardId,
        fromColumnId: sourceColumn?.id ?? task.column_id,
        toColumnId: targetColumn.id,
      },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
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
      sql: `
        SELECT th.*, tasks.due_date, tasks.title AS task_title
        FROM task_history th
        LEFT JOIN tasks ON tasks.id = th.task_id
        WHERE th.board_id = ? AND th.task_id = ?
        ORDER BY th.created_at DESC
      `,
      args: [params.boardId, params.taskId],
    });

    return { history: result.rows };
  })

  .get('/tasks/:taskId/history', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const taskResult = await db.execute({
      sql: 'SELECT board_id FROM tasks WHERE id = ?',
      args: [params.taskId],
    });

    const task = taskResult.rows[0] as { board_id: string } | undefined;
    if (!task) {
      set.status = 404;
      return { message: 'Task not found' };
    }

    const boardAccess = await getAccessibleBoard(task.board_id, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const result = await db.execute({
      sql: `
        SELECT th.*, tasks.due_date, tasks.title AS task_title
        FROM task_history th
        LEFT JOIN tasks ON tasks.id = th.task_id
        WHERE th.task_id = ?
        ORDER BY th.created_at DESC
      `,
      args: [params.taskId],
    });

    return { history: result.rows };
  });
