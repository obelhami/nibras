import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { hasPermission } from '../lib/permissions';
import {
  computeOperationalKpis,
  computeFocusScore,
  computeTeamPulse,
  type KpiTaskRow,
  type KpiHistoryRow,
} from '../lib/kpi';

type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string | null;
};

async function getCurrentUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);
  if (!payload || payload.purpose === 'verification') {
    return null;
  }

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const row = result.rows[0] as
    | { id: number | string; username: string; email: string; role: string | null }
    | undefined;

  if (!row) return null;

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
    role: row.role ?? (typeof payload.role === 'string' ? payload.role : null),
  };
}

/** Window helper: ISO timestamp `days` ago (used to scope focus / pulse). */
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3_600_000).toISOString();
}

/** Store KPI step — append the computed run so the dashboard can read trends. */
async function storeSnapshot(
  scope: 'board' | 'team' | 'user',
  scopeId: string,
  kpiType: 'operational' | 'focus_score' | 'team_pulse',
  payload: unknown,
) {
  await db.execute({
    sql: `INSERT INTO kpi_snapshots (id, scope, scope_id, kpi_type, payload)
          VALUES (?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), scope, scopeId, kpiType, JSON.stringify(payload)],
  });
}

// ---------- Aggregation Engine: fetch rows for a board ----------

async function fetchBoardTasks(boardId: string): Promise<KpiTaskRow[]> {
  const result = await db.execute({
    sql: `SELECT id, status_slug, due_date, complexity, assignee_email, created_at, updated_at
          FROM tasks WHERE board_id = ?`,
    args: [boardId],
  });
  return result.rows as unknown as KpiTaskRow[];
}

async function fetchBoardHistory(boardId: string): Promise<KpiHistoryRow[]> {
  const result = await db.execute({
    sql: `
      SELECT
        th.task_id,
        th.from_status_slug,
        th.to_status_slug,
        th.moved_by_email,
        th.note,
        th.created_at,
        fc.position AS from_position,
        tc.position AS to_position
      FROM task_history th
      LEFT JOIN board_columns fc ON fc.id = th.from_column_id
      LEFT JOIN board_columns tc ON tc.id = th.to_column_id
      WHERE th.board_id = ?
      ORDER BY th.created_at ASC
    `,
    args: [boardId],
  });
  return result.rows as unknown as KpiHistoryRow[];
}

async function getBoard(boardId: string) {
  const result = await db.execute({
    sql: 'SELECT id, owner_email, visibility, team_id FROM boards WHERE id = ?',
    args: [boardId],
  });
  return result.rows[0] as
    | { id: string; owner_email: string; visibility: string; team_id: string | null }
    | undefined;
}

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

async function canViewBoardKpis(
  board: { owner_email: string; visibility: string; team_id: string | null },
  user: AuthUser,
): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (board.owner_email === user.email) return true;
  if (board.visibility === 'public') return true;
  if (board.team_id) return isTeamMember(board.team_id, user.id);
  return false;
}

export default new Elysia()
  // KPI-01 — Operational KPIs for a board (ADT, VRR, ERR, Review Saturation).
  .get('/kpi/boards/:boardId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const board = await getBoard(params.boardId);
    if (!board) {
      set.status = 404;
      return { message: 'Board not found' };
    }

    if (!(await canViewBoardKpis(board, user))) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const [tasks, history] = await Promise.all([
      fetchBoardTasks(params.boardId),
      fetchBoardHistory(params.boardId),
    ]);

    const kpis = computeOperationalKpis(tasks, history);
    await storeSnapshot('board', params.boardId, 'operational', kpis);

    return { boardId: params.boardId, kpis, generatedAt: new Date().toISOString() };
  })

  // KPI-02 — Focus Score for a single user. Self, or manager/admin.
  .get('/kpi/users/:email/focus', async ({ headers, params, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const targetEmail = decodeURIComponent(params.email);
    const isSelf = targetEmail === user.email;
    if (!isSelf && !hasPermission(user.role, 'view_team_kpis')) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const days = Number(query.days) > 0 ? Number(query.days) : 30;
    const focus = await computeUserFocus(targetEmail, days);
    await storeSnapshot('user', targetEmail, 'focus_score', focus);

    return { windowDays: days, focus, generatedAt: new Date().toISOString() };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // KPI-03 — Team Pulse for a team. Members, or manager/admin.
  .get('/kpi/teams/:teamId/pulse', async ({ headers, params, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const team = await db.execute({ sql: 'SELECT id FROM teams WHERE id = ?', args: [params.teamId] });
    if (team.rows.length === 0) {
      set.status = 404;
      return { message: 'Team not found' };
    }

    const allowed = hasPermission(user.role, 'view_team_kpis') || (await isTeamMember(params.teamId, user.id));
    if (!allowed) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const days = Number(query.days) > 0 ? Number(query.days) : 30;
    const pulse = await computeTeamPulseForTeam(params.teamId, days);
    await storeSnapshot('team', params.teamId, 'team_pulse', pulse);

    return { teamId: params.teamId, windowDays: days, pulse, generatedAt: new Date().toISOString() };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // Dashboard Visualization data — pulse + per-member focus for one team.
  .get('/kpi/teams/:teamId/dashboard', async ({ headers, params, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const team = await db.execute({ sql: 'SELECT id, name FROM teams WHERE id = ?', args: [params.teamId] });
    if (team.rows.length === 0) {
      set.status = 404;
      return { message: 'Team not found' };
    }

    const allowed = hasPermission(user.role, 'view_team_kpis') || (await isTeamMember(params.teamId, user.id));
    if (!allowed) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const days = Number(query.days) > 0 ? Number(query.days) : 30;
    const pulse = await computeTeamPulseForTeam(params.teamId, days);

    // Focus score for every member of the team.
    const memberRows = await db.execute({
      sql: `SELECT users.email FROM team_members
            JOIN users ON users.id = team_members.user_id
            WHERE team_members.team_id = ?`,
      args: [params.teamId],
    });
    const memberEmails = (memberRows.rows as unknown as Array<{ email: string }>).map((row) => row.email);
    const focusScores = await Promise.all(memberEmails.map((email) => computeUserFocus(email, days)));

    return {
      teamId: params.teamId,
      windowDays: days,
      pulse,
      focusScores,
      generatedAt: new Date().toISOString(),
    };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // Stored snapshot history (for trend charts on the dashboard).
  .get('/kpi/snapshots', async ({ headers, query, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!hasPermission(user.role, 'view_team_kpis')) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const limit = Number(query.limit) > 0 ? Math.min(Number(query.limit), 200) : 50;
    const result = await db.execute({
      sql: `SELECT id, scope, scope_id, kpi_type, payload, generated_at
            FROM kpi_snapshots
            WHERE scope = ? AND scope_id = ?
            ORDER BY generated_at DESC
            LIMIT ?`,
      args: [query.scope, query.scopeId, limit],
    });

    const snapshots = (result.rows as unknown as Array<{
      id: string; scope: string; scope_id: string; kpi_type: string; payload: string; generated_at: string;
    }>).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));

    return { snapshots };
  }, {
    query: t.Object({
      scope: t.String(),
      scopeId: t.String(),
      limit: t.Optional(t.String()),
    }),
  });

// ---------- service helpers shared by the routes ----------

async function computeUserFocus(email: string, days: number) {
  const since = sinceIso(days);

  const assignedResult = await db.execute({
    sql: `SELECT id, status_slug, due_date, complexity, assignee_email, created_at, updated_at
          FROM tasks WHERE assignee_email = ?`,
    args: [email],
  });
  const assignedTasks = assignedResult.rows as unknown as KpiTaskRow[];

  const movesResult = await db.execute({
    sql: `SELECT task_id, from_status_slug, to_status_slug, moved_by_email, note, created_at,
                 NULL AS from_position, NULL AS to_position
          FROM task_history
          WHERE moved_by_email = ? AND created_at >= ?
          ORDER BY created_at ASC`,
    args: [email, since],
  });
  const userMoves = movesResult.rows as unknown as KpiHistoryRow[];

  const reassignmentResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM task_assignment_history
          WHERE from_email IS NOT NULL
            AND (from_email = ? OR to_email = ?)
            AND created_at >= ?`,
    args: [email, email, since],
  });
  const reassignments = Number((reassignmentResult.rows[0] as unknown as { count: number | string }).count ?? 0);

  return computeFocusScore(email, assignedTasks, userMoves, reassignments);
}

async function computeTeamPulseForTeam(teamId: string, days: number) {
  const since = sinceIso(days);

  // All boards owned by the team.
  const boardRows = await db.execute({ sql: 'SELECT id FROM boards WHERE team_id = ?', args: [teamId] });
  const boardIds = (boardRows.rows as unknown as Array<{ id: string }>).map((row) => row.id);

  const memberResult = await db.execute({
    sql: 'SELECT COUNT(*) AS count FROM team_members WHERE team_id = ?',
    args: [teamId],
  });
  const memberCount = Number((memberResult.rows[0] as unknown as { count: number | string }).count ?? 0);

  if (boardIds.length === 0) {
    return computeTeamPulse([], [], memberCount, 0);
  }

  const placeholders = boardIds.map(() => '?').join(', ');

  const tasksResult = await db.execute({
    sql: `SELECT id, status_slug, due_date, complexity, assignee_email, created_at, updated_at
          FROM tasks WHERE board_id IN (${placeholders})`,
    args: boardIds,
  });
  const tasks = tasksResult.rows as unknown as KpiTaskRow[];

  const historyResult = await db.execute({
    sql: `SELECT task_id, from_status_slug, to_status_slug, moved_by_email, note, created_at,
                 NULL AS from_position, NULL AS to_position
          FROM task_history
          WHERE board_id IN (${placeholders}) AND created_at >= ?`,
    args: [...boardIds, since],
  });
  const history = historyResult.rows as unknown as KpiHistoryRow[];

  const reassignmentResult = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM task_assignment_history
          WHERE board_id IN (${placeholders}) AND from_email IS NOT NULL AND created_at >= ?`,
    args: [...boardIds, since],
  });
  const reassignments = Number((reassignmentResult.rows[0] as unknown as { count: number | string }).count ?? 0);

  return computeTeamPulse(tasks, history, memberCount, reassignments);
}
