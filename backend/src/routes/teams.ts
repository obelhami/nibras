import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { unauthorized, forbidden, notFound, validationError, conflict, internalError } from '../lib/errors';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';
import { normalizeText } from '../lib/validation';

type AuthUser = {
  id: number | string;
  username: string;
  email: string;
  role: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  manager_id: string;
  created_at: string;
};

function serializeTeam(row: TeamRow) {
  return {
    id: row.id,
    name: row.name,
    managerId: row.manager_id,
    createdAt: row.created_at,
  };
}

// Authentifie le token et recharge l'utilisateur depuis la base (pour
// avoir son role à jour). Pas de système de permission ici : lib/permissions.ts

async function getAuthenticatedUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);
  if (!payload) return null;

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE id = ?',
    args: [payload.userId ?? payload.email],
  });

  const row = result.rows[0] as { id: number | string; username: string; email: string; role: string | null } | undefined;
  if (!row) return null;

  return row;
}

async function getTeamById(teamId: string) {
  const result = await db.execute({
    sql: 'SELECT * FROM teams WHERE id = ?',
    args: [teamId],
  });
  return result.rows[0] as unknown as TeamRow | undefined;
}

// manager_id control : seul le manager qui possède la team (manager_id)
// ou un admin peut la modifier / gérer ses membres.
function isTeamManager(team: TeamRow, user: AuthUser): boolean {
  return user.role === 'admin' || String(team.manager_id) === String(user.id);
}

async function isTeamMember(teamId: string, userId: number | string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [teamId, String(userId)],
  });
  return result.rows.length > 0;
}

async function canViewTeam(team: TeamRow, user: AuthUser): Promise<boolean> {
  if (isTeamManager(team, user)) return true;
  return isTeamMember(team.id, user.id);
}

export default new Elysia()
  // Team CRUD - Create (manager/admin uniquement)
  .post('/teams', async ({ headers, body, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    if (user.role !== 'manager' && user.role !== 'admin') {
      return forbidden(set, 'Only a manager or admin can create a team');
    }

    const name = normalizeText(body.name);
    if (!name) return validationError(set, 'Team name is required');

    const teamId = crypto.randomUUID();
    // manager_id control : par défaut le créateur devient manager de la
    // team ; un admin peut explicitement désigner un autre manager.
    const managerId = user.role === 'admin' && typeof body.managerId === 'string'
      ? body.managerId
      : String(user.id);

    await db.execute({
      sql: 'INSERT INTO teams (id, name, manager_id) VALUES (?, ?, ?)',
      args: [teamId, name, managerId],
    });

    return {
      message: 'Team created successfully',
      team: { id: teamId, name, managerId },
    };
  }, {
    body: t.Object({
      name: t.String(),
      managerId: t.Optional(t.String()),
    }),
  })

  // Team CRUD - Read (liste) + Pagination + manager_id control (scope)
  .get('/teams', async ({ headers, query, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const { page, limit, offset } = parsePagination(query);

    let whereClause = '';
    const args: Array<string | number> = [];

    // manager_id control : admin voit tout, sinon uniquement les teams
    // managées par l'utilisateur ou dont il est membre.
    if (user.role !== 'admin') {
      whereClause = `
        WHERE t.manager_id = ?
           OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.user_id = ?)
      `;
      args.push(String(user.id), String(user.id));
    }

    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM teams t ${whereClause}`,
      args,
    });
    const total = Number((countResult.rows[0] as unknown as { total: number | string }).total ?? 0);

    const listResult = await db.execute({
      sql: `
        SELECT t.* FROM teams t
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    });

    const teams = (listResult.rows as unknown as TeamRow[]).map(serializeTeam);

    return { teams, pagination: buildPaginationMeta(page, limit, total) };
  })

  // Team CRUD - Read (une team) + List team members
  .get('/teams/:teamId', async ({ headers, params, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    const allowed = await canViewTeam(team, user);
    if (!allowed) return forbidden(set, 'You do not have access to this team');

    // List team members
    const membersResult = await db.execute({
      sql: `
        SELECT u.id, u.username, u.email, u.role
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
      `,
      args: [team.id],
    });

    return { team: serializeTeam(team), members: membersResult.rows };
  })

  // Team CRUD - Update + manager_id control
  .patch('/teams/:teamId', async ({ headers, params, body, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    // manager_id control
    if (!isTeamManager(team, user)) {
      return forbidden(set, 'Only the team manager or an admin can update this team');
    }

    const updates: string[] = [];
    const args: string[] = [];

    if (typeof body.name === 'string') {
      const name = normalizeText(body.name);
      if (!name) return validationError(set, 'Team name cannot be empty');
      updates.push('name = ?');
      args.push(name);
    }

    if (typeof body.managerId === 'string') {
      const newManager = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [body.managerId] });
      if (newManager.rows.length === 0) return validationError(set, 'managerId does not match an existing user');
      updates.push('manager_id = ?');
      args.push(body.managerId);
    }

    if (updates.length === 0) return validationError(set, 'No team changes provided');

    await db.execute({
      sql: `UPDATE teams SET ${updates.join(', ')} WHERE id = ?`,
      args: [...args, params.teamId],
    });

    const updated = await getTeamById(params.teamId);
    return { message: 'Team updated successfully', team: updated ? serializeTeam(updated) : null };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      managerId: t.Optional(t.String()),
    }),
  })

  // Team CRUD - Delete + manager_id control
  .delete('/teams/:teamId', async ({ headers, params, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    // manager_id control
    if (!isTeamManager(team, user)) {
      return forbidden(set, 'Only the team manager or an admin can delete this team');
    }

    await db.execute({ sql: 'DELETE FROM teams WHERE id = ?', args: [params.teamId] });
    return { message: 'Team deleted successfully' };
  })

  // List team members
  .get('/teams/:teamId/members', async ({ headers, params, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    const allowed = await canViewTeam(team, user);
    if (!allowed) return forbidden(set, 'You do not have access to this team');

    const membersResult = await db.execute({
      sql: `
        SELECT u.id, u.username, u.email, u.role
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
      `,
      args: [team.id],
    });

    return { members: membersResult.rows };
  })

  // Add member + Prevent duplicates + manager_id control
  .post('/teams/:teamId/members', async ({ headers, params, body, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    // manager_id control
    if (!isTeamManager(team, user)) {
      return forbidden(set, 'Only the team manager or an admin can add members');
    }

    const userId = normalizeText(body.userId);
    if (!userId) return validationError(set, 'userId is required');

    const memberResult = await db.execute({ sql: 'SELECT id, email FROM users WHERE id = ?', args: [userId] });
    const member = memberResult.rows[0] as { id: string | number; email: string } | undefined;
    if (!member) return notFound(set, 'User not found');

    try {
      await db.execute({
        sql: 'INSERT INTO team_members (team_id, user_id) VALUES (?, ?)',
        args: [params.teamId, String(member.id)],
      });
    } catch (error: any) {
      // Prevent duplicates : violation de la clé primaire composite
      if (error?.message?.includes('PRIMARY') || error?.message?.includes('UNIQUE')) {
        return conflict(set, 'User is already a member of this team');
      }
      return internalError(set);
    }

    return { message: 'Member added successfully' };
  }, {
    body: t.Object({
      userId: t.String(),
    }),
  })

  // Remove member + manager_id control
  .delete('/teams/:teamId/members/:userId', async ({ headers, params, set }) => {
    const user = await getAuthenticatedUser(headers.authorization);
    if (!user) return unauthorized(set);

    const team = await getTeamById(params.teamId);
    if (!team) return notFound(set, 'Team not found');

    // manager_id control
    if (!isTeamManager(team, user)) {
      return forbidden(set, 'Only the team manager or an admin can remove members');
    }

    if (String(params.userId) === String(team.manager_id)) {
      return validationError(set, 'Cannot remove the team manager from the team; reassign managerId first');
    }

    await db.execute({
      sql: 'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
      args: [params.teamId, params.userId],
    });

    return { message: 'Member removed successfully' };
  });