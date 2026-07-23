import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import {
  computeOperationalKpis,
  computeFocusScore,
  computeTeamPulse,
  computeCRT,
  computeADR,
  computePRR,
  computeSLI,
  computeEmotionalKpis,
  type KpiTaskRow,
  type KpiHistoryRow,
  type KpiCommentRow,
  type ProactiveTaskRow,
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
  kpiType: 'operational' | 'focus_score' | 'team_pulse' | 'lds' | 'emotional' | 'self_learning',
  payload: unknown,
) {
  await db.execute({
    sql: `INSERT INTO kpi_snapshots (id, scope, scope_id, kpi_type, payload)
          VALUES (?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), scope, scopeId, kpiType, JSON.stringify(payload)],
  });
}

// ---------- Aggregation Engine: fetch rows for a board ----------
// (exported: reused by the AI Engine, routes/ai.ts)

export async function fetchBoardTasks(boardId: string): Promise<KpiTaskRow[]> {
  const result = await db.execute({
    sql: `SELECT id, status_slug, due_date, complexity, assignee_email, created_at, updated_at
          FROM tasks WHERE board_id = ?`,
    args: [boardId],
  });
  return result.rows as unknown as KpiTaskRow[];
}

export async function fetchBoardHistory(boardId: string): Promise<KpiHistoryRow[]> {
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

async function fetchBoardComments(boardId: string): Promise<KpiCommentRow[]> {
  const result = await db.execute({
    sql: `SELECT task_id, created_at FROM task_comments WHERE board_id = ?`,
    args: [boardId],
  });
  return result.rows as unknown as KpiCommentRow[];
}

async function fetchBoardProactiveTasks(boardId: string): Promise<ProactiveTaskRow[]> {
  const result = await db.execute({
    sql: `SELECT id, status_slug, due_date, complexity, assignee_email, created_at, updated_at, is_proactive
          FROM tasks WHERE board_id = ?`,
    args: [boardId],
  });
  return result.rows as unknown as ProactiveTaskRow[];
}

export async function getBoard(boardId: string) {
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

// BR-07 : "A Manager only sees teams or projects under responsibility."
async function isManagerOfTeam(teamId: string | null, userId: string): Promise<boolean> {
  if (!teamId) return false;
  const result = await db.execute({
    sql: 'SELECT 1 FROM teams WHERE id = ? AND manager_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

export async function canViewBoardKpis(
  board: { owner_email: string; visibility: string; team_id: string | null },
  user: AuthUser,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (board.owner_email === user.email) return true;
  if (board.visibility === 'public') return true;
  // BR-07 : un manager ne voit les KPIs que des boards des équipes qu'il dirige.
  if (user.role === 'manager') return isManagerOfTeam(board.team_id, user.id);
  if (board.team_id) return isTeamMember(board.team_id, user.id);
  return false;
}

// BR-07 : un manager ne peut voir le Focus Score / SLI d'un utilisateur que
// si cet utilisateur appartient à (au moins) une équipe que ce manager dirige.
async function isManagerOfUserTeam(targetEmail: string, managerId: string): Promise<boolean> {
  const result = await db.execute({
    sql: `
      SELECT 1
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      JOIN users u ON u.id = tm.user_id
      WHERE u.email = ? AND t.manager_id = ?
      LIMIT 1
    `,
    args: [targetEmail, managerId],
  });
  return result.rows.length > 0;
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

  // KPI-03bis (LDS Glossary) — CRT, ADR, PRR for a board.
  .get('/kpi/boards/:boardId/lds', async ({ headers, params, set }) => {
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

    const [history, comments, proactiveTasks] = await Promise.all([
      fetchBoardHistory(params.boardId),
      fetchBoardComments(params.boardId),
      fetchBoardProactiveTasks(params.boardId),
    ]);

    const lds = {
      crtHours: computeCRT(history),
      adr: computeADR(history, comments),
      prr: computePRR(proactiveTasks),
    };
    await storeSnapshot('board', params.boardId, 'lds', lds);

    return { boardId: params.boardId, lds, generatedAt: new Date().toISOString() };
  })

  // Emotional KPIs (CDC §16) — Consistency, Deadline Safety, Bottleneck,
  // Blocked Time Ratio, Risk Velocity, Delivery Stability Index.
  .get('/kpi/boards/:boardId/emotional', async ({ headers, params, set }) => {
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

    const emotional = computeEmotionalKpis(tasks, history);
    await storeSnapshot('board', params.boardId, 'emotional', emotional);

    return { boardId: params.boardId, emotional, generatedAt: new Date().toISOString() };
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
    if (!isSelf) {
      // BR-07 : un manager ne voit le Focus Score que des membres des
      // équipes qu'il dirige ; l'admin voit tout le monde.
      const allowed = user.role === 'admin'
        || (user.role === 'manager' && (await isManagerOfUserTeam(targetEmail, user.id)));
      if (!allowed) {
        set.status = 403;
        return { message: 'Forbidden' };
      }
    }

    const days = Number(query.days) > 0 ? Number(query.days) : 30;
    const focus = await computeUserFocus(targetEmail, days);
    await storeSnapshot('user', targetEmail, 'focus_score', focus);

    return { windowDays: days, focus, generatedAt: new Date().toISOString() };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // SLI (LDS Glossary) — Self Learning Index for a single user. Self, or manager/admin.
  .get('/kpi/users/:email/sli', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const targetEmail = decodeURIComponent(params.email);
    const isSelf = targetEmail === user.email;
    if (!isSelf) {
      // BR-07 : même règle que pour le Focus Score — un manager ne voit le
      // SLI que des membres des équipes qu'il dirige.
      const allowed = user.role === 'admin'
        || (user.role === 'manager' && (await isManagerOfUserTeam(targetEmail, user.id)));
      if (!allowed) {
        set.status = 403;
        return { message: 'Forbidden' };
      }
    }

    const completedResult = await db.execute({
      sql: `
        SELECT t.id AS taskId, t.created_at AS createdAt, MIN(th.created_at) AS doneAt
        FROM tasks t
        JOIN task_history th ON th.task_id = t.id AND th.to_status_slug = 'done'
        WHERE t.assignee_email = ?
        GROUP BY t.id
      `,
      args: [targetEmail],
    });
    const completedTasks = completedResult.rows as unknown as
      Array<{ taskId: string; createdAt: string; doneAt: string }>;

    const sli = computeSLI(completedTasks);
    await storeSnapshot('user', targetEmail, 'self_learning', sli);

    return { email: targetEmail, sli, generatedAt: new Date().toISOString() };
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

    // BR-07 : un manager ne voit ce team-scope que des équipes qu'il dirige ;
    // les membres de l'équipe et l'admin y ont aussi accès.
    const allowed = user.role === 'admin'
      || (user.role === 'manager' && (await isManagerOfTeam(params.teamId, user.id)))
      || (await isTeamMember(params.teamId, user.id));
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

    // BR-07 : un manager ne voit ce team-scope que des équipes qu'il dirige ;
    // les membres de l'équipe et l'admin y ont aussi accès.
    const allowed = user.role === 'admin'
      || (user.role === 'manager' && (await isManagerOfTeam(params.teamId, user.id)))
      || (await isTeamMember(params.teamId, user.id));
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

    // BR-07 : un manager ne peut consulter l'historique KPI que dans son
    // périmètre (équipe qu'il dirige, board de cette équipe, ou membre de
    // son équipe). L'admin voit tout ; un utilisateur voit toujours le sien.
    if (user.role !== 'admin') {
      let allowed = false;

      if (query.scope === 'team') {
        allowed = (user.role === 'manager' && (await isManagerOfTeam(query.scopeId, user.id)))
          || (await isTeamMember(query.scopeId, user.id));
      } else if (query.scope === 'board') {
        const scopedBoard = await getBoard(query.scopeId);
        if (scopedBoard) {
          allowed = scopedBoard.owner_email === user.email
            || scopedBoard.visibility === 'public'
            || (user.role === 'manager' && (await isManagerOfTeam(scopedBoard.team_id, user.id)))
            || (scopedBoard.team_id ? await isTeamMember(scopedBoard.team_id, user.id) : false);
        }
      } else if (query.scope === 'user') {
        allowed = query.scopeId === user.email
          || (user.role === 'manager' && (await isManagerOfUserTeam(query.scopeId, user.id)));
      }

      if (!allowed) {
        set.status = 403;
        return { message: 'Forbidden' };
      }
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

// ---------- service helpers shared by the routes (and by the AI Engine) ----------

export async function computeUserFocus(email: string, days: number) {
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

export async function computeTeamPulseForTeam(teamId: string, days: number) {
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
