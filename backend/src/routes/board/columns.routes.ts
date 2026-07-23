import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../../db';
import { logAuditEvent } from '../../lib/audit';
import { clientIpFromHeaders } from '../../lib/rateLimit';
import { recalculateBoardState } from './metrics';
import {
  type ColumnRow,
  getCurrentUser,
  getManageableBoard,
  normalizeText,
  slugifyColumnName,
} from './shared';

export default new Elysia()
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

    await logAuditEvent({
      action: 'column_created',
      actorEmail: user.email,
      targetType: 'column',
      targetId: columnId,
      details: { boardId: params.boardId, name },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
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

    await logAuditEvent({
      action: 'column_updated',
      actorEmail: user.email,
      targetType: 'column',
      targetId: params.columnId,
      details: { boardId: params.boardId, fields: Object.keys(body) },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
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

    await logAuditEvent({
      action: 'column_deleted',
      actorEmail: user.email,
      targetType: 'column',
      targetId: params.columnId,
      details: { boardId: params.boardId },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
    });

    await recalculateBoardState(params.boardId);

    return { message: 'Column deleted successfully' };
  });
