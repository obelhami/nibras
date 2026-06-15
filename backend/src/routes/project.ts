import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { requirePermission } from '../lib/guard';

export default new Elysia()
 .post('/projects', async ({ headers, body, set }) => {
  const user = await requirePermission(
    headers.authorization,
    'create_project',
    set as unknown as { status: number },
  );

  if (!user) {
    return { message: 'Unauthorized' };
  }

  const name = body.name.trim();

  if (!name) {
    set.status = 400;
    return { message: 'Project name is required' };
  }

  const projectId = crypto.randomUUID();

  const status = body.status ?? 'active';

  // validate status
  const allowedStatus = ['active', 'on_hold', 'completed', 'archived'];
  if (!allowedStatus.includes(status)) {
    set.status = 400;
    return { message: 'Invalid status value' };
  }

  await db.execute({
    sql: `
      INSERT INTO projects (
        id,
        name,
        description,
        start_date,
        end_date,
        status,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      projectId,
      name,
      body.description ?? null,
      body.startDate ?? null,
      body.endDate ?? null,
      status,
      user.id, // IMPORTANT FIX
    ],
  });

  return {
    message: 'Project created successfully',
    project: {
      id: projectId,
      name,
      description: body.description ?? null,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      status,
      createdBy: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    },
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

.post('/projects/:projectId/teams', async ({ headers, params, body, set }) => {
  const user = await requirePermission(
    headers.authorization,
    'create_project',
    set as unknown as { status: number },
  );

  if (!user) {
    return { message: 'Unauthorized' };
  }

  const { projectId } = params;
  const { teamId } = body;

  const projectResult = await db.execute({
    sql: 'SELECT id FROM projects WHERE id = ?',
    args: [projectId],
  });

  if (projectResult.rows.length === 0) {
    set.status = 404;
    return { message: 'Project not found' };
  }

  const teamResult = await db.execute({
    sql: 'SELECT id FROM teams WHERE id = ?',
    args: [teamId],
  });

  if (teamResult.rows.length === 0) {
    set.status = 404;
    return { message: 'Team not found' };
  }

  try {
    await db.execute({
      sql: `
        INSERT INTO project_teams (project_id, team_id)
        VALUES (?, ?)
      `,
      args: [projectId, teamId],
    });
  } catch (error: any) {
    if (error?.message?.includes('PRIMARY') || error?.message?.includes('UNIQUE')) {
      set.status = 409;
      return { message: 'Team is already assigned to this project' };
    }

    set.status = 500;
    return { message: 'Internal server error' };
  }

  return { message: 'Team assigned to project' };
}, {
  body: t.Object({
    teamId: t.String(),
  }),
})

.get('/projects', async({ headers, set}) => {
  const user = await requirePermission(headers.authorization,
    'view_project',
    set as unknown as {status:number},
  )
      if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }
    // Check whether `updated_at` exists on the projects table (some DBs may be older)
    const pragma = await db.execute({ sql: `PRAGMA table_info(projects)`, args: [] });
    const cols = (pragma.rows as any[]).map((r: any) => r.name || r['name']);
    const includeUpdated = cols.includes('updated_at');

    const sql = `
      SELECT
        id,
        name,
        description,
        start_date,
        end_date,
        status,
        created_by,
        created_at${includeUpdated ? ',\n        updated_at' : ''}
      FROM projects
    `;

    const result = await db.execute({ sql, args: [] });
    return { projects: result.rows };
  
  })