/**
 * AL MASSAR — Unit tests : moteur de règles pur (src/lib/almassar.ts)
 *
 * computeTrajectory() est une fonction pure (pas de DB, pas de HTTP) : on
 * teste directement le code de production, même approche que kpi.test.ts.
 *
 * Usage :
 *   bun test src/tests/almassar.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { computeTrajectory, type TrajectoryInput } from '../lib/almassar';

function makeInput(overrides: Partial<TrajectoryInput> = {}): TrajectoryInput {
  return {
    pulseScore: 80,
    pulseState: 'healthy',
    deliveryStabilityIndex: 80,
    deadlineSafety: 90,
    bottleneckScore: 90,
    riskVelocity: 0,
    memberCount: 5,
    overloadedMembersCount: 0,
    previousScores: [78, 82, 80],
    ...overrides,
  };
}

describe('computeTrajectory — classification', () => {
  test('healthy team with stable metrics is classified as saine', () => {
    const result = computeTrajectory(makeInput());
    expect(result.status).toBe('saine');
    expect(result.trend).toBe('stable');
  });

  test('critical team pulse always classifies as rupture', () => {
    const result = computeTrajectory(makeInput({ pulseState: 'critical', pulseScore: 30 }));
    expect(result.status).toBe('rupture');
  });

  test('very low composite score classifies as rupture even without a critical pulse', () => {
    const result = computeTrajectory(makeInput({
      pulseScore: 20,
      pulseState: 'unstable',
      deliveryStabilityIndex: 20,
      deadlineSafety: 20,
      bottleneckScore: 20,
    }));
    expect(result.status).toBe('rupture');
  });

  test('declining trend with widespread overload classifies as toxique', () => {
    const result = computeTrajectory(makeInput({
      pulseScore: 55,
      deliveryStabilityIndex: 55,
      overloadedMembersCount: 3,
      memberCount: 5,
      previousScores: [70, 72, 68], // baseline well above current score -> declining
    }));
    expect(result.status).toBe('toxique');
  });

  test('mid-range score without acute signals classifies as fragile', () => {
    const result = computeTrajectory(makeInput({
      pulseScore: 55,
      deliveryStabilityIndex: 55,
      deadlineSafety: 60,
      bottleneckScore: 60,
      previousScores: [55, 56, 54],
    }));
    expect(result.status).toBe('fragile');
  });

  test('score is clamped to the 0-100 range', () => {
    const result = computeTrajectory(makeInput({
      pulseScore: 0,
      deliveryStabilityIndex: 0,
      deadlineSafety: 0,
      bottleneckScore: 0,
      riskVelocity: 100,
      overloadedMembersCount: 5,
    }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('computeTrajectory — trend', () => {
  test('no history yields a stable trend and reduced confidence', () => {
    const result = computeTrajectory(makeInput({ previousScores: [] }));
    expect(result.trend).toBe('stable');
    expect(result.confidence).toBeLessThan(0.7);
  });

  test('score rising well above recent baseline is classified as improving', () => {
    const result = computeTrajectory(makeInput({ pulseScore: 95, deliveryStabilityIndex: 95, previousScores: [60, 62, 58] }));
    expect(result.trend).toBe('improving');
  });

  test('confidence increases with more historical snapshots', () => {
    const shallow = computeTrajectory(makeInput({ previousScores: [80] }));
    const deep = computeTrajectory(makeInput({ previousScores: [80, 81, 79, 80, 82] }));
    expect(deep.confidence).toBeGreaterThan(shallow.confidence);
  });
});

describe('computeTrajectory — evidence', () => {
  test('evidence cites the overload signal when members are overloaded', () => {
    const result = computeTrajectory(makeInput({ overloadedMembersCount: 2, memberCount: 5 }));
    expect(result.evidence.some((line) => line.includes('Surcharge silencieuse'))).toBe(true);
  });

  test('evidence flags a thin history below 3 snapshots', () => {
    const result = computeTrajectory(makeInput({ previousScores: [80] }));
    expect(result.evidence.some((line) => line.includes('Historique encore limité'))).toBe(true);
  });
});
