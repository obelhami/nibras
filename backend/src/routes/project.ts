import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { requirePermission } from '../lib/guard';
import { permissionDenied, forbidden, notFound, validationError, conflict, internalError } from '../lib/errors';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { normalizeText, isValidDateString, isValidDateRange } from '../lib/validation';
import { logAuditEvent } from '../lib/audit';
import { clientIpFromHeaders } from '../lib/rateLimit';

const ALLOWED_STATUSES = ['active', 'on_hold', 'completed', 'archived'];

type AuthUser = {
  id: number | string;
  username: string;
  email: string;
  role: string;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_by: string;
  team_id: string | null;
  created_at: string;
  updated_at: string;
};

function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getProjectById(projectId: string) {
  const result = await db.execute({
    sql: 'SELECT * FROM projects WHERE id = ?',
    args: [projectId],
  });

  return result.rows[0] as unknown as ProjectRow | undefined;
}

// Certaines bases n'ont pas (encore) la colonne `updated_at` sur `projects`
// (la migration de db.ts peut échouer silencieusement selon l'environnement
// Turso). On vérifie une seule fois, en cache, plutôt que de planter sur
// chaque PATCH avec "no such column: updated_at".
let hasUpdatedAtColumnCache: boolean | null = null;

async function hasUpdatedAtColumn(): Promise<boolean> {
  if (hasUpdatedAtColumnCache !== null) return hasUpdatedAtColumnCache;

  try {
    const result = await db.execute('PRAGMA table_info(projects)');
    const columns = (result.rows as unknown as Array<{ name: string }>).map((row) => row.name);
    hasUpdatedAtColumnCache = columns.includes('updated_at');
  } catch {
    hasUpdatedAtColumnCache = false;
  }

  return hasUpdatedAtColumnCache;
}

// Manager/admin control : admin = accès total, manager = uniquement
// ses propres projets (créateur ou team qu'il manage). BR-07 du CDC.
async function canAccessProject(project: ProjectRow, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;

  // Number(...) plutôt que String(...) : tolère "58" et "58.0" comme
  // identiques (driver Turso qui peut stocker un id numérique des deux
  // façons selon le contexte d'insertion).
  if (Number(project.created_by) === Number(user.id)) return true;

  const result = await db.execute({
    sql: `
      SELECT 1
      FROM project_teams pt
      JOIN teams t ON t.id = pt.team_id
      WHERE pt.project_id = ? AND t.manager_id = ?
      LIMIT 1
    `,
    args: [project.id, String(user.id)],
  });

  return result.rows.length > 0;
}

export default new Elysia()
  // CRUD - Create
  .post('/projects', async ({ headers, body, set }) => {
    const user = await requirePermission(headers.authorization, 'create_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    // Validate name
    const name = normalizeText(body.name);
    if (!name) return validationError(set, 'Project name is required');

    // Validate status
    const status = body.status ?? 'active';
    if (!ALLOWED_STATUSES.includes(status)) {
      return validationError(set, `Status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    }

    // Validate dates
    const startDate = normalizeText(body.startDate) || null;
    const endDate = normalizeText(body.endDate) || null;

    if (startDate && !isValidDateString(startDate)) {
      return validationError(set, 'startDate must be a valid date (YYYY-MM-DD)');
    }
    if (endDate && !isValidDateString(endDate)) {
      return validationError(set, 'endDate must be a valid date (YYYY-MM-DD)');
    }
    if (!isValidDateRange(startDate, endDate)) {
      return validationError(set, 'startDate must be before or equal to endDate');
    }

    const projectId = crypto.randomUUID();

    await db.execute({
      sql: `
        INSERT INTO projects (id, name, description, start_date, end_date, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [projectId, name, normalizeText(body.description) || null, startDate, endDate, status, String(user.id)],
    });

    const created = await getProjectById(projectId);

    await logAuditEvent({
      action: 'project_created',
      actorEmail: user.email,
      targetType: 'project',
      targetId: projectId,
      details: { name, status },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
    });

    return {
      message: 'Project created successfully',
      project: created ? serializeProject(created) : null,
    };
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      startDate: t.Optional(t.String()),
      endDate: t.Optional(t.String()),
      status: t.Optional(t.String()),
    }),
  })

  // CRUD - Read (liste) + Filter by status + Pagination + Manager/admin control
  .get('/projects', async ({ headers, query, set }) => {
    const user = await requirePermission(headers.authorization, 'view_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    // Filter by status
    if (query.status && !ALLOWED_STATUSES.includes(query.status)) {
      return validationError(set, `Status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
    }

    // Pagination
    const { page, limit, offset } = parsePagination(query);

    const conditions: string[] = [];
    const args: Array<string | number> = [];

    // Manager/admin control
    if (user.role !== 'admin') {
      conditions.push(`
        (
          CAST(p.created_by AS REAL) = CAST(? AS REAL)
          OR EXISTS (
            SELECT 1 FROM project_teams pt
            JOIN teams t ON t.id = pt.team_id
            WHERE pt.project_id = p.id AND t.manager_id = ?
          )
        )
      `);
      args.push(String(user.id), String(user.id));
    }

    // Filter by status
    if (query.status) {
      conditions.push('p.status = ?');
      args.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM projects p ${whereClause}`,
      args,
    });
    const total = Number((countResult.rows[0] as unknown as { total: number | string }).total ?? 0);

    // Pagination
    const listResult = await db.execute({
      sql: `
        SELECT p.* FROM projects p
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    });

    const projects = (listResult.rows as unknown as ProjectRow[]).map(serializeProject);

    return { projects, pagination: buildPaginationMeta(page, limit, total) };
  })

  // CRUD - Read (un projet) + Manager/admin control
  .get('/projects/:projectId', async ({ headers, params, set }) => {
    const user = await requirePermission(headers.authorization, 'view_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    const project = await getProjectById(params.projectId);
    if (!project) return notFound(set, 'Project not found');

    const allowed = await canAccessProject(project, user);
    if (!allowed) return forbidden(set, 'You do not have access to this project');

    return { project: serializeProject(project) };
  })

  // CRUD - Update + Validate status/dates + Manager/admin control
  .patch('/projects/:projectId', async ({ headers, params, body, set }) => {
    const user = await requirePermission(headers.authorization, 'create_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    const project = await getProjectById(params.projectId);
    if (!project) return notFound(set, 'Project not found');

    const allowed = await canAccessProject(project, user);
    if (!allowed) return forbidden(set, 'You do not have access to this project');

    const updates: string[] = [];
    const args: Array<string | null> = [];

    if (typeof body.name === 'string') {
      const name = normalizeText(body.name);
      if (!name) return validationError(set, 'Project name cannot be empty');
      updates.push('name = ?');
      args.push(name);
    }

    if (typeof body.description === 'string') {
      updates.push('description = ?');
      args.push(normalizeText(body.description) || null);
    }

    // Validate status
    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return validationError(set, `Status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
      }
      updates.push('status = ?');
      args.push(body.status);
    }

    const nextStartDate = typeof body.startDate === 'string' ? (normalizeText(body.startDate) || null) : project.start_date;
    const nextEndDate = typeof body.endDate === 'string' ? (normalizeText(body.endDate) || null) : project.end_date;

    // Validate dates
    if (typeof body.startDate === 'string') {
      if (nextStartDate && !isValidDateString(nextStartDate)) {
        return validationError(set, 'startDate must be a valid date (YYYY-MM-DD)');
      }
      updates.push('start_date = ?');
      args.push(nextStartDate);
    }

    if (typeof body.endDate === 'string') {
      if (nextEndDate && !isValidDateString(nextEndDate)) {
        return validationError(set, 'endDate must be a valid date (YYYY-MM-DD)');
      }
      updates.push('end_date = ?');
      args.push(nextEndDate);
    }

    if (!isValidDateRange(nextStartDate, nextEndDate)) {
      return validationError(set, 'startDate must be before or equal to endDate');
    }

    if (updates.length === 0) {
      return validationError(set, 'No project changes provided');
    }

    if (await hasUpdatedAtColumn()) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
    }

    await db.execute({
      sql: `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
      args: [...args, params.projectId],
    });

    await logAuditEvent({
      action: 'project_updated',
      actorEmail: user.email,
      targetType: 'project',
      targetId: params.projectId,
      details: { fields: Object.keys(body) },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
    });

    const updated = await getProjectById(params.projectId);

    return {
      message: 'Project updated successfully',
      project: updated ? serializeProject(updated) : null,
    };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      description: t.Optional(t.String()),
      startDate: t.Optional(t.String()),
      endDate: t.Optional(t.String()),
      status: t.Optional(t.String()),
    }),
  })

  // CRUD - Delete + Manager/admin control (admin only)
  .delete('/projects/:projectId', async ({ headers, params, set }) => {
    const user = await requirePermission(headers.authorization, 'view_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    if (user.role !== 'admin') {
      return forbidden(set, 'Only an admin can permanently delete a project. Managers can archive it instead (PATCH status=archived).');
    }

    const project = await getProjectById(params.projectId);
    if (!project) return notFound(set, 'Project not found');

    try {
      await db.execute({ sql: 'UPDATE boards SET linked_project = NULL WHERE linked_project = ?', args: [params.projectId] });
      await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [params.projectId] });
    } catch (error) {
      return internalError(set, 'Failed to delete project');
    }

    await logAuditEvent({
      action: 'project_deleted',
      actorEmail: user.email,
      targetType: 'project',
      targetId: params.projectId,
      details: { name: project.name },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
    });

    return { message: 'Project deleted successfully' };
  })

  // Lier une team à un projet (existant, scope ajouté)
  .post('/projects/:projectId/teams', async ({ headers, params, body, set }) => {
    const user = await requirePermission(headers.authorization, 'create_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    const { projectId } = params;
    const { teamId } = body;

    const project = await getProjectById(projectId);
    if (!project) return notFound(set, 'Project not found');

    const allowed = await canAccessProject(project, user);
    if (!allowed) return forbidden(set, 'You do not have access to this project');

    const teamResult = await db.execute({
      sql: 'SELECT id FROM teams WHERE id = ?',
      args: [teamId],
    });

    if (teamResult.rows.length === 0) return notFound(set, 'Team not found');

    try {
      await db.execute({
        sql: 'INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)',
        args: [projectId, teamId],
      });
    } catch (error: any) {
      if (error?.message?.includes('PRIMARY') || error?.message?.includes('UNIQUE')) {
        return conflict(set, 'Team is already assigned to this project');
      }
      return internalError(set);
    }

    return { message: 'Team assigned to project' };
  }, {
    body: t.Object({
      teamId: t.String(),
    }),
  })

  // Détacher une team d'un projet (nouveau)
  .delete('/projects/:projectId/teams/:teamId', async ({ headers, params, set }) => {
    const user = await requirePermission(headers.authorization, 'create_project', set as unknown as { status: number });
    if (!user) return permissionDenied(set);

    const project = await getProjectById(params.projectId);
    if (!project) return notFound(set, 'Project not found');

    const allowed = await canAccessProject(project, user);
    if (!allowed) return forbidden(set, 'You do not have access to this project');

    await db.execute({
      sql: 'DELETE FROM project_teams WHERE project_id = ? AND team_id = ?',
      args: [params.projectId, params.teamId],
    });

    return { message: 'Team removed from project' };
  });