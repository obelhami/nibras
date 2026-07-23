/**
 * AI Engine — Module 8.
 *
 * TASK AI-01 — Recommendation Engine: pulls KPIs (Team Pulse + Focus Scores),
 * weak signals (Behavioral Engine) and project context for a team, runs the
 * rule engine, and persists every recommendation as a pending `ai_insights`
 * row.
 *
 * TASK AI-02 — Sprint Doctor: diagnoses one board (treated as the running
 * sprint) over a time window and stores its findings the same way.
 *
 * TASK AI-03 — Nibras Brain: interprets a team's delivery reality across all
 * of its boards — when delivery slows, it ranks competing explanations
 * before letting anyone blame the humans.
 *
 * The AI never applies anything itself — a manager must accept or dismiss
 * each insight (human validation is mandatory per spec).
 */

import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../db';
import { verifyAuthToken } from '../lib/jwt';
import { hasPermission } from '../lib/permissions';
import { detectReviewSaturation, detectSilentOverload } from '../lib/behavior';
import { logAuditEvent } from '../lib/audit';
import { clientIpFromHeaders } from '../lib/rateLimit';
import {
  computeTeamPulseForTeam,
  computeUserFocus,
  fetchBoardTasks,
  fetchBoardHistory,
  getBoard,
  canViewBoardKpis,
} from './kpi';
import {
  generateRecommendations,
  diagnoseSprint,
  interpretReality,
  type AiRecommendation,
  type WeakSignalInput,
} from '../lib/ai';

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

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [teamId, userId],
  });
  return result.rows.length > 0;
}

async function getTeamMembers(teamId: string): Promise<Array<{ id: string; email: string }>> {
  const result = await db.execute({
    sql: `SELECT users.id, users.email FROM team_members
          JOIN users ON users.id = team_members.user_id
          WHERE team_members.team_id = ?`,
    args: [teamId],
  });
  return (result.rows as unknown as Array<{ id: number | string; email: string }>).map((row) => ({
    id: String(row.id),
    email: row.email,
  }));
}

/** Project context: projects linked to the team's boards or to the team itself. */
async function getTeamProjectIds(teamId: string): Promise<string[]> {
  const result = await db.execute({
    sql: `SELECT DISTINCT linked_project AS project_id FROM boards
          WHERE team_id = ? AND linked_project IS NOT NULL
          UNION
          SELECT project_id FROM project_teams WHERE team_id = ?`,
    args: [teamId, teamId],
  });
  return (result.rows as unknown as Array<{ project_id: string }>).map((row) => row.project_id);
}

/** Weak signals from the Behavioral Engine for every member / project of the team. */
async function collectWeakSignals(
  members: Array<{ id: string; email: string }>,
  projectIds: string[],
): Promise<WeakSignalInput> {
  const overloadResults = await Promise.all(
    members.map(async (member) => ({
      email: member.email,
      result: await detectSilentOverload(member.id),
    })),
  );
  const saturationResults = await Promise.all(
    projectIds.map(async (projectId) => ({
      projectId,
      result: await detectReviewSaturation(projectId),
    })),
  );

  return {
    silentOverloads: overloadResults
      .filter((entry) => entry.result.signal === 'silent_overload')
      .map((entry) => ({ email: entry.email, confidence: entry.result.confidence })),
    reviewSaturations: saturationResults
      .filter((entry) => entry.result.signal === 'review_saturation')
      .map((entry) => ({ projectId: entry.projectId, confidence: entry.result.confidence })),
  };
}

/** Persist each recommendation as a pending insight and return the stored rows. */
async function storeInsights(
  scope: 'team' | 'board',
  scopeId: string,
  recommendations: AiRecommendation[],
) {
  return Promise.all(
    recommendations.map(async (rec) => {
      const id = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO ai_insights
                (id, scope, scope_id, type, severity, title, message)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, scope, scopeId, rec.type, rec.severity, rec.title, rec.message],
      });
      return { id, status: 'pending' as const, ...rec };
    }),
  );
}

type InsightRow = {
  id: string;
  scope: string;
  scope_id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  validated_by_email: string | null;
  validated_at: string | null;
  created_at: string;
};

const INSIGHT_COLUMNS =
  'id, scope, scope_id, type, severity, title, message, status, validated_by_email, validated_at, created_at';

export default new Elysia()
  // AI-01 — Generate contextual recommendations for a team.
  // Inputs (per spec): KPIs, weak signals, project context, historical patterns.
  .get('/ai/teams/:teamId/recommendations', async ({ headers, params, query, set }) => {
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

    const [members, projectIds, pulse] = await Promise.all([
      getTeamMembers(params.teamId),
      getTeamProjectIds(params.teamId),
      computeTeamPulseForTeam(params.teamId, days),
    ]);

    const [focusScores, signals] = await Promise.all([
      Promise.all(members.map((member) => computeUserFocus(member.email, days))),
      collectWeakSignals(members, projectIds),
    ]);

    const recommendations = generateRecommendations({ pulse, focusScores, signals });
    const insights = await storeInsights('team', params.teamId, recommendations);

    return {
      teamId: params.teamId,
      windowDays: days,
      // Spec: the AI never takes automatic decisions — a manager must
      // accept or dismiss each insight via PATCH /ai/insights/:id.
      requiresHumanValidation: true,
      recommendations: insights,
      context: { pulse, focusScores, signals, projectIds },
      generatedAt: new Date().toISOString(),
    };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // AI-02 — Sprint Doctor: diagnose one board as the running sprint.
  // Detects: fragile sprint, unstable velocity, bottlenecks, overloaded
  // reviewers, delivery risks.
  .get('/ai/boards/:boardId/sprint-doctor', async ({ headers, params, query, set }) => {
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

    const days = Number(query.days) > 0 ? Number(query.days) : 14;
    const [tasks, history] = await Promise.all([
      fetchBoardTasks(params.boardId),
      fetchBoardHistory(params.boardId),
    ]);

    const diagnosis = diagnoseSprint(tasks, history, days);
    const findings = await storeInsights('board', params.boardId, diagnosis.findings);

    return {
      boardId: params.boardId,
      windowDays: days,
      requiresHumanValidation: true,
      sprint: { score: diagnosis.score, verdict: diagnosis.verdict },
      findings,
      metrics: diagnosis.metrics,
      generatedAt: new Date().toISOString(),
    };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // AI-03 — Nibras Brain: interpret the team's delivery reality.
  // When delivery slows, ranks competing explanations (review overload,
  // external validation delay, process instability, team capacity) —
  // context is interpreted before blaming humans.
  .get('/ai/teams/:teamId/brain', async ({ headers, params, query, set }) => {
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

    // Operational reality = every task and move across all the team's boards.
    const boardRows = await db.execute({
      sql: 'SELECT id FROM boards WHERE team_id = ?',
      args: [params.teamId],
    });
    const boardIds = (boardRows.rows as unknown as Array<{ id: string }>).map((row) => row.id);

    const [tasksPerBoard, historyPerBoard, members, projectIds] = await Promise.all([
      Promise.all(boardIds.map((boardId) => fetchBoardTasks(boardId))),
      Promise.all(boardIds.map((boardId) => fetchBoardHistory(boardId))),
      getTeamMembers(params.teamId),
      getTeamProjectIds(params.teamId),
    ]);
    const tasks = tasksPerBoard.flat();
    const history = historyPerBoard
      .flat()
      .sort((left, right) => left.created_at.localeCompare(right.created_at));

    const [focusScores, signals] = await Promise.all([
      Promise.all(members.map((member) => computeUserFocus(member.email, days))),
      collectWeakSignals(members, projectIds),
    ]);

    const brain = interpretReality(tasks, history, focusScores, signals, days);
    const findings = await storeInsights('team', params.teamId, brain.findings);

    return {
      teamId: params.teamId,
      windowDays: days,
      requiresHumanValidation: true,
      brain: {
        deliverySlow: brain.deliverySlow,
        symptoms: brain.symptoms,
        hypotheses: brain.hypotheses,
        interpretation: brain.interpretation,
      },
      findings,
      metrics: brain.metrics,
      generatedAt: new Date().toISOString(),
    };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  })

  // Stored insights for a scope, optionally filtered by validation status.
  .get('/ai/insights', async ({ headers, query, set }) => {
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
    const filters = ['scope = ?', 'scope_id = ?'];
    const args: Array<string | number> = [query.scope, query.scopeId];
    if (query.status) {
      filters.push('status = ?');
      args.push(query.status);
    }
    args.push(limit);

    const result = await db.execute({
      sql: `SELECT ${INSIGHT_COLUMNS} FROM ai_insights
            WHERE ${filters.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT ?`,
      args,
    });

    return { insights: result.rows as unknown as InsightRow[] };
  }, {
    query: t.Object({
      scope: t.String(),
      scopeId: t.String(),
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  // Human validation step — a manager accepts or dismisses a recommendation.
  .patch('/ai/insights/:id', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!hasPermission(user.role, 'view_team_kpis')) {
      set.status = 403;
      return { message: 'Forbidden' };
    }

    const existing = await db.execute({
      sql: `SELECT ${INSIGHT_COLUMNS} FROM ai_insights WHERE id = ?`,
      args: [params.id],
    });
    const insight = existing.rows[0] as unknown as InsightRow | undefined;
    if (!insight) {
      set.status = 404;
      return { message: 'Insight not found' };
    }

    if (insight.status !== 'pending') {
      set.status = 409;
      return { message: `Insight already ${insight.status}` };
    }

    const status = body.action === 'accept' ? 'accepted' : 'dismissed';
    const validatedAt = new Date().toISOString();
    await db.execute({
      sql: `UPDATE ai_insights
            SET status = ?, validated_by_email = ?, validated_at = ?
            WHERE id = ?`,
      args: [status, user.email, validatedAt, params.id],
    });

    await logAuditEvent({
      action: status === 'accepted' ? 'ai_recommendation_validated' : 'ai_recommendation_dismissed',
      actorEmail: user.email,
      targetType: 'ai_insight',
      targetId: params.id,
      details: { insightType: insight.type, scope: insight.scope, scopeId: insight.scope_id },
      ipAddress: clientIpFromHeaders(headers as Record<string, string | undefined>),
    });

    return {
      insight: {
        ...insight,
        status,
        validated_by_email: user.email,
        validated_at: validatedAt,
      },
    };
  }, {
    body: t.Object({
      action: t.Union([t.Literal('accept'), t.Literal('dismiss')]),
    }),
  });
