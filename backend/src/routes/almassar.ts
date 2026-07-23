/**
 * AL MASSAR — Module 17 (lecture de trajectoire)
 *
 * Endpoints team-scope. Réutilise les briques déjà testées du KPI Engine
 * (Team Pulse, Emotional KPIs) et du Behavioral Layer (surcharge silencieuse)
 * plutôt que de dupliquer leur logique — voir lib/almassar.ts pour le moteur
 * de règles pur (computeTrajectory).
 */

import { Elysia, t } from 'elysia';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { computeEmotionalKpis, type KpiTaskRow, type KpiHistoryRow } from '../lib/kpi';
import { computeTeamPulseForTeam } from './kpi';
import { detectSilentOverload } from '../lib/behavior';
import { computeTrajectory, storeTrajectorySnapshot } from '../lib/almassar';

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

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

// BR-07 : "A Manager only sees teams or projects under responsibility."
async function isManagerOfTeam(teamId: string, userId: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM teams WHERE id = ? AND manager_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

async function canViewTeamTrajectory(teamId: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role === 'manager' && (await isManagerOfTeam(teamId, user.id))) return true;
  return isTeamMember(teamId, user.id);
}

/** Aggregates emotional KPIs across every board owned by the team. */
async function computeTeamEmotionalKpis(teamId: string) {
  const boardRows = await db.execute({ sql: 'SELECT id FROM boards WHERE team_id = ?', args: [teamId] });
  const boardIds = (boardRows.rows as unknown as Array<{ id: string }>).map((row) => row.id);
  if (boardIds.length === 0) {
    return computeEmotionalKpis([], []);
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
          FROM task_history WHERE board_id IN (${placeholders})`,
    args: boardIds,
  });
  const history = historyResult.rows as unknown as KpiHistoryRow[];

  return computeEmotionalKpis(tasks, history);
}

/** Counts team members currently flagged with a silent-overload signal (confidence >= 0.7). */
async function countOverloadedMembers(teamId: string): Promise<{ overloaded: number; total: number }> {
  const memberRows = await db.execute({
    sql: 'SELECT user_id FROM team_members WHERE team_id = ?',
    args: [teamId],
  });
  const memberIds = (memberRows.rows as unknown as Array<{ user_id: string }>).map((row) => String(row.user_id));

  let overloaded = 0;
  for (const memberId of memberIds) {
    try {
      const result = await detectSilentOverload(memberId);
      if (result.signal === 'silent_overload') overloaded += 1;
    } catch {
      // A single member's signal must never break the team-wide trajectory read.
    }
  }

  return { overloaded, total: memberIds.length };
}

async function computeTeamTrajectory(teamId: string) {
  const [pulse, emotional, overload, previousSnapshots] = await Promise.all([
    computeTeamPulseForTeam(teamId, 30),
    computeTeamEmotionalKpis(teamId),
    countOverloadedMembers(teamId),
    db.execute({
      sql: `SELECT score FROM almassar_trajectories WHERE team_id = ? ORDER BY generated_at DESC LIMIT 5`,
      args: [teamId],
    }),
  ]);

  const previousScores = (previousSnapshots.rows as unknown as Array<{ score: number }>).map((r) => r.score);

  const result = computeTrajectory({
    pulseScore: pulse.score,
    pulseState: pulse.state,
    deliveryStabilityIndex: emotional.deliveryStabilityIndex,
    deadlineSafety: emotional.deadlineSafety,
    bottleneckScore: emotional.bottleneckScore,
    riskVelocity: emotional.riskVelocity,
    memberCount: overload.total,
    overloadedMembersCount: overload.overloaded,
    previousScores,
  });

  const metrics = { pulse, emotional, overloadedMembers: overload.overloaded, teamMembers: overload.total };
  return { result, metrics };
}

export default new Elysia()
  // AL MASSAR — lecture de trajectoire d'équipe (saine / fragile / toxique / rupture).
  .get('/almassar/teams/:teamId', async ({ headers, params, set }) => {
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

    if (!(await canViewTeamTrajectory(params.teamId, user))) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const { result, metrics } = await computeTeamTrajectory(params.teamId);
    await storeTrajectorySnapshot(params.teamId, result, metrics);

    return {
      teamId: params.teamId,
      trajectory: result,
      metrics,
      generatedAt: new Date().toISOString(),
    };
  })

  // Historique des lectures de trajectoire (courbe de tendance).
  .get('/almassar/teams/:teamId/history', async ({ headers, params, query, set }) => {
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

    if (!(await canViewTeamTrajectory(params.teamId, user))) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const limit = Number(query.limit) > 0 ? Math.min(Number(query.limit), 200) : 50;
    const rows = await db.execute({
      sql: `SELECT id, team_id, status, score, trend, confidence, evidence, metrics, generated_at
            FROM almassar_trajectories WHERE team_id = ? ORDER BY generated_at DESC LIMIT ?`,
      args: [params.teamId, limit],
    });

    const history = (rows.rows as unknown as Array<{
      id: string; team_id: string; status: string; score: number; trend: string;
      confidence: number; evidence: string; metrics: string; generated_at: string;
    }>).map((row) => ({
      ...row,
      evidence: JSON.parse(row.evidence),
      metrics: JSON.parse(row.metrics),
    }));

    return { teamId: params.teamId, history };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  });
