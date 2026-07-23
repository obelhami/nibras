/**
 * AL MASSAR — Module 17 (lecture de trajectoire)
 *
 * Croise le Team Pulse (KPI Engine), les KPI émotionnels (Delivery Stability
 * Index, Risk Velocity, Bottleneck, Deadline Safety) et la surcharge
 * silencieuse (Behavioral Layer) pour produire une lecture de trajectoire
 * d'équipe sur la durée : saine, fragile, toxique, ou risque de rupture.
 *
 * Contrairement au Team Pulse (état instantané), AL MASSAR regarde la
 * tendance (delta de score entre snapshots successifs) — c'est ce qui fait
 * la différence entre "fragile ponctuellement" et "toxique en continu".
 */

import { db } from '../../db';
import crypto from 'crypto';
import type { TeamPulseState } from './kpi';

export type TrajectoryStatus = 'saine' | 'fragile' | 'toxique' | 'rupture';
export type TrajectoryTrend = 'improving' | 'stable' | 'declining';

export type TrajectoryInput = {
  pulseScore: number;
  pulseState: TeamPulseState;
  deliveryStabilityIndex: number;
  deadlineSafety: number;
  bottleneckScore: number;
  riskVelocity: number;
  memberCount: number;
  overloadedMembersCount: number;
  previousScores: number[]; // most recent first, from stored snapshots
};

export type TrajectoryResult = {
  status: TrajectoryStatus;
  score: number;
  trend: TrajectoryTrend;
  confidence: number;
  evidence: string[];
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyTrend(currentScore: number, previousScores: number[]): { trend: TrajectoryTrend; delta: number } {
  if (previousScores.length === 0) return { trend: 'stable', delta: 0 };
  const baseline = previousScores.reduce((sum, v) => sum + v, 0) / previousScores.length;
  const delta = currentScore - baseline;
  if (delta > 5) return { trend: 'improving', delta: round(delta) };
  if (delta < -5) return { trend: 'declining', delta: round(delta) };
  return { trend: 'stable', delta: round(delta) };
}

/**
 * Pure rule engine — no DB access, easy to unit test. The DB aggregation
 * (fetching team pulse / emotional KPIs / overload signals) lives in
 * routes/almassar.ts, same split as the KPI Engine (lib/kpi.ts vs routes/kpi.ts).
 */
export function computeTrajectory(input: TrajectoryInput): TrajectoryResult {
  const {
    pulseScore, pulseState, deliveryStabilityIndex, deadlineSafety,
    bottleneckScore, riskVelocity, memberCount, overloadedMembersCount, previousScores,
  } = input;

  const overloadRatio = memberCount > 0 ? overloadedMembersCount / memberCount : 0;
  const overloadPenalty = Math.min(30, overloadRatio * 60);
  const riskPenalty = Math.min(20, Math.max(0, riskVelocity) * 0.2);

  const score = Math.round(clamp(
    pulseScore * 0.5
    + deliveryStabilityIndex * 0.3
    + deadlineSafety * 0.1
    + bottleneckScore * 0.1
    - overloadPenalty
    - riskPenalty,
    0,
    100,
  ));

  const { trend, delta } = classifyTrend(score, previousScores);

  const sustainedOverload = trend === 'declining' && overloadRatio >= 1 / 3;

  let status: TrajectoryStatus;
  if (pulseState === 'critical' || score < 25) {
    status = 'rupture';
  } else if (score < 45 || sustainedOverload) {
    status = 'toxique';
  } else if (score < 65 || trend === 'declining') {
    status = 'fragile';
  } else {
    status = 'saine';
  }

  // Confidence grows with the depth of history available (a single snapshot
  // cannot tell "fragile" from "toxique-but-improving") and with team size.
  const historyConfidence = Math.min(0.5, previousScores.length * 0.1);
  const teamConfidence = memberCount > 0 ? 0.3 : 0;
  const confidence = round(clamp(0.2 + historyConfidence + teamConfidence, 0, 1));

  const evidence: string[] = [
    `Team Pulse : ${pulseState} (score ${pulseScore}/100)`,
    `Delivery Stability Index : ${deliveryStabilityIndex}/100`,
  ];
  if (overloadedMembersCount > 0) {
    evidence.push(`Surcharge silencieuse détectée pour ${overloadedMembersCount}/${memberCount} membre(s)`);
  }
  if (riskVelocity > 0) {
    evidence.push(`Risk Velocity en hausse (+${riskVelocity})`);
  }
  if (deadlineSafety < 60) {
    evidence.push(`Deadline Safety faible (${deadlineSafety}/100)`);
  }
  if (bottleneckScore < 60) {
    evidence.push(`Bottleneck Score faible (${bottleneckScore}/100) — tâches bloquées`);
  }
  evidence.push(
    trend === 'stable'
      ? 'Tendance stable sur les derniers snapshots'
      : `Tendance ${trend === 'improving' ? 'en amélioration' : 'en dégradation'} (${delta >= 0 ? '+' : ''}${delta} pts vs moyenne récente)`,
  );
  if (previousScores.length < 3) {
    evidence.push('Historique encore limité — confiance réduite tant que peu de snapshots existent');
  }

  return { status, score, trend, confidence, evidence };
}

export async function runAlMassarMigration() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS almassar_trajectories (
      id            TEXT PRIMARY KEY,
      team_id       TEXT NOT NULL,
      status        TEXT NOT NULL,   -- 'saine' | 'fragile' | 'toxique' | 'rupture'
      score         INTEGER NOT NULL,
      trend         TEXT NOT NULL,   -- 'improving' | 'stable' | 'declining'
      confidence    REAL NOT NULL,
      evidence      TEXT NOT NULL DEFAULT '[]',
      metrics       TEXT NOT NULL DEFAULT '{}',
      generated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_almassar_team ON almassar_trajectories(team_id, generated_at DESC)`,
    );
  } catch {
    // index already exists
  }

  console.log('✅ AL MASSAR migration applied');
}

export async function storeTrajectorySnapshot(
  teamId: string,
  result: TrajectoryResult,
  metrics: Record<string, unknown>,
) {
  await db.execute({
    sql: `INSERT INTO almassar_trajectories (id, team_id, status, score, trend, confidence, evidence, metrics)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      teamId,
      result.status,
      result.score,
      result.trend,
      result.confidence,
      JSON.stringify(result.evidence),
      JSON.stringify(metrics),
    ],
  });
}
