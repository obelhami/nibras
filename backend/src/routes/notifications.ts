/**
 * Module 9 — Notification System
 * Routes REST pour les notifications in-app.
 *
 * GET    /notifications                           → liste paginée
 * GET    /notifications/unread-count              → badge
 * PATCH  /notifications/read-all                  → tout marquer lu
 * PATCH  /notifications/:id/read                  → marquer une notif lue
 * DELETE /notifications/:id                       → supprimer une notif
 * DELETE /notifications                           → supprimer toutes les notifs lues
 * POST   /notifications/trigger/overdue           → scan overdue (manager/admin)
 * POST   /notifications/trigger/review-saturation → scan saturation (manager/admin)
 */

import { Elysia, t } from 'elysia';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { unauthorized, forbidden, notFound } from '../lib/errors';
import { notifyOverdueTask, notifyReviewSaturation } from '../lib/notifications';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';

type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string | null;
};

async function getCurrentUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);
  if (!payload || payload.purpose === 'verification') return null;

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const row = result.rows[0] as unknown as
    | { id: number | string; username: string; email: string; role: string | null }
    | undefined;
  if (!row) return null;

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
    role: row.role,
  };
}

const notificationRoutes = new Elysia({ prefix: '/notifications' })

  // GET /notifications
  .get(
    '/',
    async ({ headers, query, set }) => {
      const user = await getCurrentUser(headers.authorization);
      if (!user) return unauthorized(set);

      const { page, limit, offset } = parsePagination(query);

      const conditions: string[] = ['recipient_email = ?'];
      const args: (string | number)[] = [user.email];

      if (query.type) {
        conditions.push('type = ?');
        args.push(query.type as string);
      }
      if (query.severity) {
        conditions.push('severity = ?');
        args.push(query.severity as string);
      }
      if (query.unread === 'true') {
        conditions.push('read_at IS NULL');
      }

      const where = conditions.join(' AND ');

      const [countResult, rowsResult] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) as total FROM notifications WHERE ${where}`, args }),
        db.execute({
          sql: `
            SELECT id, type, severity, title, message,
                   entity_type, entity_id, read_at, created_at
            FROM notifications
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `,
          args: [...args, limit, offset],
        }),
      ]);

      const total = Number((countResult.rows[0] as unknown as { total: number }).total);

      return {
        data: rowsResult.rows,
        pagination: buildPaginationMeta(page, limit, total),
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(t.String()),
        severity: t.Optional(t.String()),
        unread: t.Optional(t.String()),
      }),
    },
  )

  // GET /notifications/unread-count
  .get('/unread-count', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    const result = await db.execute({
      sql: `SELECT COUNT(*) as count FROM notifications
            WHERE recipient_email = ? AND read_at IS NULL`,
      args: [user.email],
    });

    return { unread_count: Number((result.rows[0] as unknown as { count: number }).count) };
  })

  // PATCH /notifications/read-all
  .patch('/read-all', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    await db.execute({
      sql: `UPDATE notifications SET read_at = datetime('now')
            WHERE recipient_email = ? AND read_at IS NULL`,
      args: [user.email],
    });

    return { message: 'All notifications marked as read' };
  })

  // PATCH /notifications/:id/read
  .patch(
    '/:id/read',
    async ({ headers, params, set }) => {
      const user = await getCurrentUser(headers.authorization);
      if (!user) return unauthorized(set);

      const result = await db.execute({
        sql: 'SELECT id, recipient_email, read_at FROM notifications WHERE id = ?',
        args: [params.id],
      });

      const notif = result.rows[0] as unknown as
        | { id: string; recipient_email: string; read_at: string | null }
        | undefined;

      if (!notif) return notFound(set, 'Notification not found');
      if (notif.recipient_email !== user.email) return forbidden(set, 'Access denied');
      if (notif.read_at) return { message: 'Notification already marked as read' };

      await db.execute({
        sql: `UPDATE notifications SET read_at = datetime('now') WHERE id = ?`,
        args: [params.id],
      });

      return { message: 'Notification marked as read' };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // DELETE /notifications/:id
  .delete(
    '/:id',
    async ({ headers, params, set }) => {
      const user = await getCurrentUser(headers.authorization);
      if (!user) return unauthorized(set);

      const result = await db.execute({
        sql: 'SELECT id, recipient_email FROM notifications WHERE id = ?',
        args: [params.id],
      });

      const notif = result.rows[0] as unknown as
        | { id: string; recipient_email: string }
        | undefined;

      if (!notif) return notFound(set, 'Notification not found');
      if (notif.recipient_email !== user.email) return forbidden(set, 'Access denied');

      await db.execute({ sql: 'DELETE FROM notifications WHERE id = ?', args: [params.id] });

      return { message: 'Notification deleted' };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // DELETE /notifications  (supprime toutes les notifs lues)
  .delete('/', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);

    await db.execute({
      sql: `DELETE FROM notifications WHERE recipient_email = ? AND read_at IS NOT NULL`,
      args: [user.email],
    });

    return { message: 'All read notifications deleted' };
  })

  // POST /notifications/trigger/overdue
  .post('/trigger/overdue', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);
    if (user.role !== 'manager' && user.role !== 'admin')
      return forbidden(set, 'Only managers and admins can trigger overdue scan');

    const result = await db.execute(`
      SELECT t.id, t.title, t.due_date, ta.user_email as assignee_email
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.due_date IS NOT NULL
        AND datetime(t.due_date) < datetime('now')
        AND t.status_slug NOT IN ('done', 'closed', 'completed')
      LIMIT 50
    `);

    let triggered = 0;

    for (const row of result.rows as unknown as Array<{
      id: string; title: string; due_date: string; assignee_email: string | null;
    }>) {
      if (!row.assignee_email) continue;

      const existing = await db.execute({
        sql: `SELECT id FROM notifications
              WHERE recipient_email = ? AND type = 'overdue_task'
                AND entity_id = ? AND date(created_at) = date('now')
              LIMIT 1`,
        args: [row.assignee_email, row.id],
      });

      if (existing.rows.length > 0) continue;

      await notifyOverdueTask({
        recipientEmail: row.assignee_email,
        taskTitle: row.title,
        taskId: row.id,
        dueDate: row.due_date,
      });

      triggered++;
    }

    return { message: 'Overdue scan complete', notifications_created: triggered };
  })

  // POST /notifications/trigger/review-saturation
  .post('/trigger/review-saturation', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) return unauthorized(set);
    if (user.role !== 'manager' && user.role !== 'admin')
      return forbidden(set, 'Only managers and admins can trigger review saturation scan');

    const boardsResult = await db.execute({
      sql: `SELECT id, title FROM boards WHERE owner_email = ?`,
      args: [user.email],
    });

    const SATURATION_THRESHOLD = 3;
    let triggered = 0;

    for (const board of boardsResult.rows as unknown as Array<{ id: string; title: string }>) {
      const countResult = await db.execute({
        sql: `
          SELECT COUNT(*) as cnt
          FROM tasks t
          JOIN board_columns bc ON bc.id = t.column_id
          WHERE t.board_id = ?
            AND (LOWER(bc.slug) LIKE '%review%' OR LOWER(bc.name) LIKE '%review%')
            AND t.status_slug NOT IN ('done', 'closed')
        `,
        args: [board.id],
      });

      const cnt = Number((countResult.rows[0] as unknown as { cnt: number }).cnt);
      if (cnt < SATURATION_THRESHOLD) continue;

      const existing = await db.execute({
        sql: `SELECT id FROM notifications
              WHERE recipient_email = ? AND type = 'review_saturation'
                AND entity_id = ? AND date(created_at) = date('now')
              LIMIT 1`,
        args: [user.email, board.id],
      });

      if (existing.rows.length > 0) continue;

      await notifyReviewSaturation({
        managerEmail: user.email,
        boardId: board.id,
        boardTitle: board.title,
        reviewCount: cnt,
      });

      triggered++;
    }

    return { message: 'Review saturation scan complete', notifications_created: triggered };
  });

export default notificationRoutes;