/**
 * M06 — Audit global — Routes de consultation du journal.
 * Réservé aux Admins uniquement.
 *
 * GET /audit/events → liste paginée avec filtres acteur/action/période
 */

import { Elysia, t } from 'elysia';
import { db } from '../../db';
import { requirePermission } from '../lib/guard';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { forbidden } from '../lib/errors';

export default new Elysia()

  .get(
    '/audit/events',
    async ({ headers, query, set }) => {
      const user = await requirePermission(headers.authorization, 'manage_users', set);
      if (!user) return forbidden(set, 'Access restricted to Admins');

      const { page, limit, offset } = parsePagination(query);

      const conditions: string[] = [];
      const args: (string | number)[] = [];

      if (query.actor) { conditions.push('actor_email = ?'); args.push(query.actor as string); }
      if (query.action) { conditions.push('action = ?'); args.push(query.action as string); }
      if (query.target_type) { conditions.push('target_type = ?'); args.push(query.target_type as string); }
      if (query.from) { conditions.push('created_at >= ?'); args.push(query.from as string); }
      if (query.to) { conditions.push('created_at <= ?'); args.push(query.to as string); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [countResult, rowsResult] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) as total FROM audit_events ${where}`, args }),
        db.execute({
          sql: `SELECT id, action, actor_email, target_type, target_id, details, ip_address, created_at
                FROM audit_events ${where}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?`,
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
        actor: t.Optional(t.String()),
        action: t.Optional(t.String()),
        target_type: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    },
  );