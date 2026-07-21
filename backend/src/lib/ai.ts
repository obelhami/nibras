/**
 * AI Engine — Module 8
 *
 * TASK AI-01 — Recommendation Engine: rule-based interpretation layer that
 * turns already-computed analytics (KPI results, Behavioral Engine weak
 * signals) into contextual recommendations for managers.
 *
 * TASK AI-02 — Sprint Doctor: diagnoses the health of one board treated as
 * the running sprint (fragile sprint, unstable velocity, bottlenecks,
 * overloaded reviewers, delivery risks).
 *
 * TASK AI-03 — Nibras Brain: the interpretation layer. When delivery slows
 * down, it weighs competing explanations (review overload, external
 * validation delay, process instability, team capacity) against the evidence
 * and interprets context BEFORE blaming humans — team capacity is only ever
 * the residual explanation, considered after the others are ruled out.
 *
 * Same convention as lib/kpi.ts: no DB access here — routes/ai.ts fetches and
 * aggregates, these functions stay pure and unit-testable.
 *
 * IMPORTANT (spec): the AI never takes automatic decisions. Every
 * recommendation is stored as `pending` and requires human validation.
 */

import type { KpiTaskRow, KpiHistoryRow } from './kpi';

export type AiSeverity = 'info' | 'warning' | 'critical';

export type AiRecommendation = {
  /** Stable rule identifier, e.g. 'review_saturation'. */
  type: string;
  severity: AiSeverity;
  title: string;
  message: string;
};

/** Shape of computeTeamPulse() output that the rules consume. */
export type PulseInput = {
  state: 'healthy' | 'overloaded' | 'unstable' | 'critical';
  score: number;
  inputs: Record<string, number>;
};

/** Shape of computeFocusScore() output that the rules consume. */
export type FocusInput = {
  email: string;
  score: number;
  label: string;
  indicators: Record<string, number>;
};

/** Weak signals from the Behavioral Engine, resolved per member / project. */
export type WeakSignalInput = {
  silentOverloads: Array<{ email: string; confidence: number }>;
  reviewSaturations: Array<{ projectId: string; confidence: number }>;
};

export type RecommendationContext = {
  pulse?: PulseInput;
  focusScores?: FocusInput[];
  signals?: WeakSignalInput;
};

const SEVERITY_ORDER: Record<AiSeverity, number> = { critical: 0, warning: 1, info: 2 };

// ---------- rules ----------

/**
 * Each rule inspects the context and returns a recommendation or null.
 * Thresholds mirror the ones already used by the KPI / Behavioral engines
 * (e.g. Team Pulse flags `unstable` at reviewSaturation > 50%).
 */

function ruleReviewSaturation(ctx: RecommendationContext): AiRecommendation | null {
  const kpiSaturation = ctx.pulse?.inputs.reviewSaturation ?? 0; // %
  const topSignalConfidence = Math.max(
    0,
    ...(ctx.signals?.reviewSaturations.map((entry) => entry.confidence) ?? []),
  );

  const fromKpi = kpiSaturation >= 50;
  const fromSignal = topSignalConfidence >= 0.7;
  if (!fromKpi && !fromSignal) return null;

  return {
    type: 'review_saturation',
    severity: kpiSaturation >= 70 || topSignalConfidence >= 0.85 ? 'critical' : 'warning',
    title: 'Review queue is saturated',
    message: 'Review queue is saturated. Consider redistributing validation workload.',
  };
}

function ruleTeamCritical(ctx: RecommendationContext): AiRecommendation | null {
  if (ctx.pulse?.state !== 'critical') return null;

  return {
    type: 'team_critical',
    severity: 'critical',
    title: 'Team health is critical',
    message:
      'Team Pulse is in a critical state. Immediate intervention is recommended: '
      + 'review overdue work, unblock stuck tasks and reduce active workload.',
  };
}

function ruleTeamOverloaded(ctx: RecommendationContext): AiRecommendation | null {
  const workload = ctx.pulse?.inputs.workloadPerMember ?? 0;
  if (ctx.pulse?.state !== 'overloaded' && workload <= 5) return null;

  return {
    type: 'team_overloaded',
    severity: 'warning',
    title: 'Workload exceeds team capacity',
    message:
      `Average workload is ${workload} active tasks per member. `
      + 'Consider rebalancing assignments, deferring low-priority work or limiting work in progress.',
  };
}

function ruleDeliveryDelays(ctx: RecommendationContext): AiRecommendation | null {
  const delayRate = ctx.pulse?.inputs.delayRate ?? 0; // %
  if (delayRate < 30) return null;

  return {
    type: 'delivery_delays',
    severity: delayRate >= 50 ? 'critical' : 'warning',
    title: 'Deliveries are frequently late',
    message:
      `${delayRate}% of completed tasks were delivered after their due date. `
      + 'Consider re-planning deadlines or adding buffer to estimates.',
  };
}

function ruleOverdueBacklog(ctx: RecommendationContext): AiRecommendation | null {
  const overdueRatio = ctx.pulse?.inputs.overdueRatio ?? 0; // %
  if (overdueRatio < 25) return null;

  return {
    type: 'overdue_backlog',
    severity: overdueRatio >= 40 ? 'critical' : 'warning',
    title: 'Overdue tasks are accumulating',
    message:
      `${overdueRatio}% of active tasks are past their due date. `
      + 'Consider triaging the overdue backlog and re-prioritising or re-scoping.',
  };
}

function ruleBlockerTriage(ctx: RecommendationContext): AiRecommendation | null {
  const blockers = ctx.pulse?.inputs.blockers ?? 0;
  if (blockers < 5) return null;

  return {
    type: 'blocker_triage',
    severity: 'warning',
    title: 'Recurring blockers detected',
    message:
      `${blockers} blocker events were recorded in the analysis window. `
      + 'Consider running a blocker triage session to identify and remove the root causes.',
  };
}

function ruleMemberOverload(ctx: RecommendationContext): AiRecommendation[] {
  const overloads = ctx.signals?.silentOverloads ?? [];
  return overloads
    .filter((entry) => entry.confidence >= 0.7)
    .map((entry) => ({
      type: 'member_silent_overload',
      severity: 'warning' as AiSeverity,
      title: `Possible silent overload: ${entry.email}`,
      message:
        `${entry.email} shows signs of silent overload (irregular activity, growing backlog). `
        + 'Consider redistributing part of their workload and checking in with them.',
    }));
}

function ruleLowFocus(ctx: RecommendationContext): AiRecommendation[] {
  const scores = ctx.focusScores ?? [];
  return scores
    .filter((focus) => focus.score < 40)
    .map((focus) => ({
      type: 'member_low_focus',
      severity: 'info' as AiSeverity,
      title: `Low focus score: ${focus.email}`,
      message:
        `${focus.email} has a focus score of ${focus.score} (${focus.label}). `
        + 'Consider reducing parallel assignments and context switching for this member.',
    }));
}

// ---------- engine ----------

/**
 * Run every rule against the aggregated context and return recommendations,
 * most severe first. Always returns at least one entry: when nothing fires,
 * an `all_clear` info recommendation confirms the analysis ran.
 */
export function generateRecommendations(ctx: RecommendationContext): AiRecommendation[] {
  const recommendations: AiRecommendation[] = [
    ruleReviewSaturation(ctx),
    ruleTeamCritical(ctx),
    ruleTeamOverloaded(ctx),
    ruleDeliveryDelays(ctx),
    ruleOverdueBacklog(ctx),
    ruleBlockerTriage(ctx),
    ...ruleMemberOverload(ctx),
    ...ruleLowFocus(ctx),
  ].filter((rec): rec is AiRecommendation => rec !== null);

  if (recommendations.length === 0) {
    recommendations.push({
      type: 'all_clear',
      severity: 'info',
      title: 'No significant risks detected',
      message: 'Delivery indicators look healthy. No corrective action is recommended right now.',
    });
  }

  recommendations.sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  return recommendations;
}

// ---------- TASK AI-02 — Sprint Doctor ----------

const DONE = 'done';
const REVIEW = 'review';
const DAY_MS = 86_400_000;

export type SprintVerdict = 'healthy' | 'fragile' | 'critical';

export type SprintDiagnosis = {
  /** 0–100 sprint health (higher = healthier). */
  score: number;
  verdict: SprintVerdict;
  /** Same shape as AI-01 recommendations so they share the validation flow. */
  findings: AiRecommendation[];
  /** Measured facts the diagnosis was derived from. */
  metrics: {
    windowDays: number;
    activeTasks: number;
    completedInWindow: number;
    weeklyThroughput: number[];
    velocityCv: number;
    columns: Array<{ slug: string; count: number; sharePct: number; avgAgeDays: number }>;
    reviewers: Array<{ email: string; reviewExits: number }>;
    inReview: number;
    overdueTasks: number;
    dueSoonTasks: number;
    blockers: number;
    backwardMoves: number;
    totalMoves: number;
  };
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Diagnose the health of a sprint (= one board over a time window).
 *
 * @param tasks      all tasks currently on the board.
 * @param history    full task_history of the board, time-ordered ascending.
 * @param windowDays sprint length to analyze (default 14).
 * @param now        injected current time (ms) for testability.
 */
export function diagnoseSprint(
  tasks: KpiTaskRow[],
  history: KpiHistoryRow[],
  windowDays = 14,
  now: number = Date.now(),
): SprintDiagnosis {
  const windowStart = now - windowDays * DAY_MS;
  const inWindow = history.filter((row) => new Date(row.created_at).getTime() >= windowStart);
  const activeTasks = tasks.filter((task) => task.status_slug !== DONE);
  const findings: AiRecommendation[] = [];

  // --- Unstable velocity: completions per week across the window ---
  const firstDoneAt = new Map<string, number>();
  for (const row of history) {
    if (row.to_status_slug === DONE && !firstDoneAt.has(row.task_id)) {
      firstDoneAt.set(row.task_id, new Date(row.created_at).getTime());
    }
  }
  const doneTimes = [...firstDoneAt.values()].filter((time) => time >= windowStart);
  const bucketCount = Math.max(1, Math.ceil(windowDays / 7));
  const weeklyThroughput = Array.from({ length: bucketCount }, () => 0);
  for (const time of doneTimes) {
    const index = Math.min(bucketCount - 1, Math.floor((time - windowStart) / (7 * DAY_MS)));
    weeklyThroughput[index]! += 1;
  }
  const velocityCv = mean(weeklyThroughput) === 0 ? 0 : stdDev(weeklyThroughput) / mean(weeklyThroughput);
  const unstableVelocity = bucketCount >= 2 && doneTimes.length >= 4 && velocityCv >= 0.7;
  if (unstableVelocity) {
    findings.push({
      type: 'unstable_velocity',
      severity: 'warning',
      title: 'Velocity is unstable',
      message:
        `Weekly throughput over the sprint window was [${weeklyThroughput.join(', ')}] completed tasks. `
        + 'Delivery rhythm is irregular — check for hidden blockers or uneven task sizing.',
    });
  }

  // --- Bottlenecks: active columns holding too many / too-old tasks ---
  // Last time each task entered its current status (fallback: task timestamps).
  const statusEnteredAt = new Map<string, number>();
  for (const row of history) {
    if (row.to_status_slug) {
      statusEnteredAt.set(`${row.task_id}|${row.to_status_slug}`, new Date(row.created_at).getTime());
    }
  }
  const agesByColumn = new Map<string, number[]>();
  for (const task of activeTasks) {
    const enteredAt = statusEnteredAt.get(`${task.id}|${task.status_slug}`)
      ?? new Date(task.updated_at ?? task.created_at).getTime();
    const ages = agesByColumn.get(task.status_slug) ?? [];
    ages.push((now - enteredAt) / DAY_MS);
    agesByColumn.set(task.status_slug, ages);
  }
  const columns = [...agesByColumn.entries()].map(([slug, ages]) => ({
    slug,
    count: ages.length,
    sharePct: round((ages.length / Math.max(activeTasks.length, 1)) * 100),
    avgAgeDays: round(mean(ages)),
  }));
  for (const column of columns) {
    const crowded = column.count >= 3 && column.sharePct >= 40;
    const stale = column.count >= 3 && column.avgAgeDays >= 5;
    if (!crowded && !stale) continue;
    findings.push({
      type: 'sprint_bottleneck',
      severity: column.sharePct >= 60 ? 'critical' : 'warning',
      title: `Bottleneck in "${column.slug}"`,
      message:
        `${column.count} tasks (${column.sharePct}% of active work) are sitting in "${column.slug}"`
        + `${stale ? `, on average for ${column.avgAgeDays} days` : ''}. `
        + 'Work is piling up at this stage — investigate what is blocking it from moving forward.',
    });
  }

  // --- Overloaded reviewers: who moves tasks OUT of review ---
  const reviewExitCounts = new Map<string, number>();
  for (const row of inWindow) {
    if (row.from_status_slug === REVIEW) {
      reviewExitCounts.set(row.moved_by_email, (reviewExitCounts.get(row.moved_by_email) ?? 0) + 1);
    }
  }
  const reviewers = [...reviewExitCounts.entries()]
    .map(([email, reviewExits]) => ({ email, reviewExits }))
    .sort((left, right) => right.reviewExits - left.reviewExits);
  const totalExits = reviewers.reduce((sum, reviewer) => sum + reviewer.reviewExits, 0);
  const topShare = totalExits > 0 ? reviewers[0]!.reviewExits / totalExits : 0;
  const inReview = activeTasks.filter((task) => task.status_slug === REVIEW).length;
  if (reviewers.length >= 2 && totalExits >= 4 && topShare >= 0.6) {
    findings.push({
      type: 'overloaded_reviewer',
      severity: 'warning',
      title: `Review load concentrated on ${reviewers[0]!.email}`,
      message:
        `${reviewers[0]!.email} handled ${reviewers[0]!.reviewExits} of ${totalExits} review completions `
        + 'in the sprint window. Consider spreading review duty across more members.',
    });
  } else if (inReview >= 3 && reviewers.length <= 1) {
    findings.push({
      type: 'review_single_point',
      severity: 'warning',
      title: 'Review depends on a single reviewer',
      message:
        `${inReview} tasks are waiting in review and at most one person is completing reviews. `
        + 'The sprint has a review single-point-of-failure — nominate additional reviewers.',
    });
  }

  // --- Delivery risks: overdue work, deadlines about to slip, blockers, rework ---
  const overdueTasks = activeTasks.filter(
    (task) => task.due_date != null && new Date(task.due_date).getTime() < now,
  ).length;
  const overdueRatio = activeTasks.length > 0 ? overdueTasks / activeTasks.length : 0;
  if (overdueTasks >= 1) {
    findings.push({
      type: 'delivery_risk_overdue',
      severity: overdueRatio >= 0.4 ? 'critical' : 'warning',
      title: 'Sprint scope is slipping',
      message:
        `${overdueTasks} of ${activeTasks.length} active tasks are already past their due date. `
        + 'Re-scope the sprint or re-plan the affected deadlines.',
    });
  }

  const dueSoonTasks = activeTasks.filter((task) => {
    if (!task.due_date || task.status_slug === REVIEW) return false;
    const due = new Date(task.due_date).getTime();
    return due >= now && due <= now + 3 * DAY_MS;
  }).length;
  if (dueSoonTasks >= 2) {
    findings.push({
      type: 'delivery_risk_due_soon',
      severity: 'warning',
      title: 'Deadlines at risk within 3 days',
      message:
        `${dueSoonTasks} tasks are due within 3 days and have not reached review yet. `
        + 'They are unlikely to be validated in time — prioritise or re-plan them.',
    });
  }

  const blockers = inWindow.filter((row) => !!row.note && /block/i.test(row.note)).length;
  if (blockers >= 3) {
    findings.push({
      type: 'sprint_blockers',
      severity: 'warning',
      title: 'Blockers are accumulating',
      message:
        `${blockers} blocker events were recorded during the sprint window. `
        + 'Run a blocker triage to unblock the sprint.',
    });
  }

  let totalMoves = 0;
  let backwardMoves = 0;
  for (const row of inWindow) {
    if (row.from_position == null || row.to_position == null) continue;
    totalMoves += 1;
    if (row.to_position < row.from_position) backwardMoves += 1;
  }
  const backwardRatio = totalMoves > 0 ? backwardMoves / totalMoves : 0;
  if (totalMoves >= 5 && backwardRatio >= 0.2) {
    findings.push({
      type: 'sprint_rework',
      severity: 'warning',
      title: 'High rework rate',
      message:
        `${round(backwardRatio * 100)}% of column moves in the sprint went backwards. `
        + 'Tasks keep being rejected — check acceptance criteria and definition of done.',
    });
  }

  // --- Fragile sprint: composite health score from capped penalties ---
  const bottleneckCount = findings.filter((finding) => finding.type === 'sprint_bottleneck').length;
  const reviewerPenalty = findings.some(
    (finding) => finding.type === 'overloaded_reviewer' || finding.type === 'review_single_point',
  ) ? 15 : 0;
  const score = Math.round(Math.max(0, Math.min(100,
    100
    - (unstableVelocity ? 20 : 0)
    - Math.min(30, bottleneckCount * 15)
    - reviewerPenalty
    - Math.min(25, overdueRatio * 50)
    - Math.min(15, blockers * 3)
    - Math.min(10, backwardRatio * 50),
  )));
  const verdict: SprintVerdict = score >= 70 ? 'healthy' : score >= 40 ? 'fragile' : 'critical';

  findings.push({
    type: 'sprint_health',
    severity: verdict === 'healthy' ? 'info' : verdict === 'fragile' ? 'warning' : 'critical',
    title: `Sprint health: ${verdict} (${score}/100)`,
    message: verdict === 'healthy'
      ? 'The sprint looks stable. No corrective action is recommended right now.'
      : `The sprint is ${verdict}: ${findings.length} issue(s) detected. `
        + 'Review the findings above and validate the ones you want to act on.',
  });

  findings.sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  return {
    score,
    verdict,
    findings,
    metrics: {
      windowDays,
      activeTasks: activeTasks.length,
      completedInWindow: doneTimes.length,
      weeklyThroughput,
      velocityCv: round(velocityCv),
      columns,
      reviewers,
      inReview,
      overdueTasks,
      dueSoonTasks,
      blockers,
      backwardMoves,
      totalMoves,
    },
  };
}

// ---------- TASK AI-03 — Nibras Brain ----------

export type BrainVerdict = 'likely' | 'possible' | 'unlikely';

export type BrainHypothesis = {
  /** Stable hypothesis id, e.g. 'review_overload'. */
  id: string;
  /** The question the Brain is answering (from the spec). */
  question: string;
  verdict: BrainVerdict;
  /** Human sentence citing the numbers behind the verdict. */
  reasoning: string;
};

export type BrainInterpretation = {
  deliverySlow: boolean;
  /** Human descriptions of the symptoms that were detected. */
  symptoms: string[];
  /** All hypotheses, most plausible first. */
  hypotheses: BrainHypothesis[];
  /** The narrative conclusion — what the Brain believes is going on. */
  interpretation: string;
  /** Stored as pending insights, same validation flow as AI-01/AI-02. */
  findings: AiRecommendation[];
  metrics: {
    windowDays: number;
    activeTasks: number;
    completedInWindow: number;
    adtDays: number;
    delayRatePct: number;
    overdueRatioPct: number;
    inReview: number;
    avgReviewAgeDays: number;
    reviewExitsInWindow: number;
    blockers: number;
    reworkPct: number;
    silentOverloadCount: number;
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 0 at `min`, 1 at `max`, linear in between. */
function norm(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
}

function verdictOf(score: number): BrainVerdict {
  if (score >= 0.6) return 'likely';
  if (score >= 0.3) return 'possible';
  return 'unlikely';
}

const VERDICT_ORDER: Record<BrainVerdict, number> = { likely: 0, possible: 1, unlikely: 2 };

/**
 * Interpret the operational reality of a team (all its boards) over a window.
 *
 * The core question is the spec's example: "delivery becomes slow — why?".
 * Each hypothesis gets an evidence score from the data; team capacity is
 * scored as the RESIDUAL (what remains of the slowdown once every external
 * explanation is accounted for), which encodes the spec rule "interpret
 * context before blaming humans".
 *
 * @param tasks       tasks across all of the team's boards.
 * @param history     task_history across those boards, time-ordered ascending.
 * @param focusScores per-member Focus Scores (KPI-02), for the capacity nuance.
 * @param signals     Behavioral Engine weak signals for members/projects.
 */
export function interpretReality(
  tasks: KpiTaskRow[],
  history: KpiHistoryRow[],
  focusScores: FocusInput[] = [],
  signals: WeakSignalInput = { silentOverloads: [], reviewSaturations: [] },
  windowDays = 30,
  now: number = Date.now(),
): BrainInterpretation {
  const windowStart = now - windowDays * DAY_MS;
  const inWindow = history.filter((row) => new Date(row.created_at).getTime() >= windowStart);
  const activeTasks = tasks.filter((task) => task.status_slug !== DONE);
  const createdAtByTask = new Map(tasks.map((task) => [task.id, task.created_at]));
  const dueByTask = new Map(tasks.map((task) => [task.id, task.due_date]));

  // --- Delivery facts ---
  const firstDoneAt = new Map<string, number>();
  for (const row of history) {
    if (row.to_status_slug === DONE && !firstDoneAt.has(row.task_id)) {
      firstDoneAt.set(row.task_id, new Date(row.created_at).getTime());
    }
  }
  const doneInWindow = [...firstDoneAt.entries()].filter(([, time]) => time >= windowStart);

  let delayed = 0;
  const deliveryDays: number[] = [];
  for (const [taskId, doneAt] of doneInWindow) {
    const due = dueByTask.get(taskId);
    if (due && doneAt > new Date(due).getTime()) delayed += 1;
    const createdAt = createdAtByTask.get(taskId);
    if (createdAt) deliveryDays.push((doneAt - new Date(createdAt).getTime()) / DAY_MS);
  }
  const adtDays = mean(deliveryDays);
  const delayRate = doneInWindow.length > 0 ? delayed / doneInWindow.length : 0;
  const overdueTasks = activeTasks.filter(
    (task) => task.due_date != null && new Date(task.due_date).getTime() < now,
  ).length;
  const overdueRatio = activeTasks.length > 0 ? overdueTasks / activeTasks.length : 0;
  const noDeliveries = activeTasks.length >= 5 && doneInWindow.length === 0;

  // --- Symptom: is delivery slow? ---
  const symptoms: string[] = [];
  if (delayRate >= 0.3) {
    symptoms.push(`${Math.round(delayRate * 100)}% of tasks completed in the window were delivered late`);
  }
  if (overdueRatio >= 0.25) {
    symptoms.push(`${overdueTasks} of ${activeTasks.length} active tasks are already past their due date`);
  }
  if (noDeliveries) {
    symptoms.push(`nothing was delivered in ${windowDays} days despite ${activeTasks.length} active tasks`);
  }
  if (adtDays >= 10) {
    symptoms.push(`average delivery time is ${round(adtDays, 1)} days`);
  }
  const slowScore = Math.max(
    norm(delayRate, 0.2, 0.7),
    norm(overdueRatio, 0.15, 0.6),
    noDeliveries ? 0.7 : 0,
    norm(adtDays, 7, 21),
  );
  const deliverySlow = symptoms.length > 0;

  // --- Evidence shared by several hypotheses ---
  const reviewTasks = activeTasks.filter((task) => task.status_slug === REVIEW);
  const statusEnteredAt = new Map<string, number>();
  for (const row of history) {
    if (row.to_status_slug) {
      statusEnteredAt.set(`${row.task_id}|${row.to_status_slug}`, new Date(row.created_at).getTime());
    }
  }
  const reviewAges = reviewTasks.map((task) => {
    const enteredAt = statusEnteredAt.get(`${task.id}|${REVIEW}`)
      ?? new Date(task.updated_at ?? task.created_at).getTime();
    return (now - enteredAt) / DAY_MS;
  });
  const avgReviewAgeDays = mean(reviewAges);
  const reviewExitsInWindow = inWindow.filter((row) => row.from_status_slug === REVIEW).length;
  const reviewSaturation = activeTasks.length > 0 ? reviewTasks.length / activeTasks.length : 0;
  const topSignalConfidence = Math.max(0, ...signals.reviewSaturations.map((entry) => entry.confidence));

  const blockers = inWindow.filter((row) => !!row.note && /block/i.test(row.note)).length;
  let totalMoves = 0;
  let backwardMoves = 0;
  for (const row of inWindow) {
    if (row.from_position == null || row.to_position == null) continue;
    totalMoves += 1;
    if (row.to_position < row.from_position) backwardMoves += 1;
  }
  const reworkRatio = totalMoves > 0 ? backwardMoves / totalMoves : 0;

  // --- Hypothesis 1: is review overloaded? ---
  const reviewOverloadScore = Math.max(
    norm(reviewSaturation, 0.3, 0.7),
    topSignalConfidence >= 0.7 ? topSignalConfidence : 0,
  );
  const reviewOverload: BrainHypothesis = {
    id: 'review_overload',
    question: 'Is review overloaded?',
    verdict: verdictOf(reviewOverloadScore),
    reasoning:
      `${reviewTasks.length} of ${activeTasks.length} active tasks (${Math.round(reviewSaturation * 100)}%) `
      + `are in review${topSignalConfidence >= 0.7 ? ', and the Behavioral Engine confirms review saturation' : ''}.`,
  };

  // --- Hypothesis 2: is validation delayed externally (client / outside reviewer)? ---
  // A full review queue that nobody is emptying points outside the team.
  const externalDelayScore = reviewTasks.length >= 2
    ? norm(avgReviewAgeDays, 3, 10) * (reviewExitsInWindow === 0 ? 1 : reviewExitsInWindow <= 2 ? 0.7 : 0.3)
    : 0;
  const externalDelay: BrainHypothesis = {
    id: 'external_validation_delay',
    question: 'Is the client (or an external validator) delaying validation?',
    verdict: verdictOf(externalDelayScore),
    reasoning:
      `${reviewTasks.length} tasks have been waiting in review for ${round(avgReviewAgeDays, 1)} days on average, `
      + `and only ${reviewExitsInWindow} review completion(s) happened in the window — `
      + (externalDelayScore >= 0.3
        ? 'work is reaching validation but not coming out, which points outside the delivery team.'
        : 'the review flow is moving, so validation does not look externally blocked.'),
  };

  // --- Hypothesis 3: is the process/infrastructure unstable? ---
  const instabilityScore = Math.max(norm(blockers, 2, 8), norm(reworkRatio, 0.15, 0.4));
  const instability: BrainHypothesis = {
    id: 'process_instability',
    question: 'Is the process or infrastructure unstable?',
    verdict: verdictOf(instabilityScore),
    reasoning:
      `${blockers} blocker event(s) and ${Math.round(reworkRatio * 100)}% backward moves (rework) `
      + 'were recorded in the window.',
  };

  // --- Hypothesis 4 (last, per spec): is the team the constraint? ---
  // Residual: only what the external explanations do NOT account for.
  const bestExternal = Math.max(reviewOverloadScore, externalDelayScore, instabilityScore);
  const capacityScore = clamp01(slowScore - bestExternal);
  const overloadedMembers = signals.silentOverloads.filter((entry) => entry.confidence >= 0.7);
  const lowFocusMembers = focusScores.filter((focus) => focus.score < 40);
  let capacityReasoning: string;
  if (!deliverySlow) {
    capacityReasoning = 'Delivery is not slow — there is no reason to question team capacity.';
  } else if (overloadedMembers.length > 0) {
    capacityReasoning =
      `${overloadedMembers.length} member(s) show silent-overload signals: the constraint looks like `
      + 'workload, not capability. Rebalance before drawing conclusions about performance.';
  } else if (capacityScore >= 0.3) {
    capacityReasoning =
      'External explanations look weak, so capacity may be the constraint'
      + (lowFocusMembers.length > 0
        ? ` — but ${lowFocusMembers.length} member(s) have poor focus scores, so check context switching first.`
        : ' — verify workload distribution and task sizing before concluding.');
  } else {
    capacityReasoning = 'The slowdown is better explained by the factors above than by team performance.';
  }
  const teamCapacity: BrainHypothesis = {
    id: 'team_capacity',
    question: 'Is the team the constraint?',
    // Overload evidence caps this at "possible": workload ≠ weakness.
    verdict: overloadedMembers.length > 0 && capacityScore >= 0.6 ? 'possible' : verdictOf(capacityScore),
    reasoning: capacityReasoning,
  };

  const hypotheses = [reviewOverload, externalDelay, instability, teamCapacity]
    .sort((left, right) => VERDICT_ORDER[left.verdict] - VERDICT_ORDER[right.verdict]);

  // --- Narrative conclusion ---
  let interpretation: string;
  if (!deliverySlow) {
    interpretation =
      `Delivery looks normal over the last ${windowDays} days `
      + `(${doneInWindow.length} tasks completed, ${Math.round(delayRate * 100)}% late). No interpretation needed.`;
  } else {
    const primary = hypotheses[0]!;
    if (primary.verdict === 'unlikely') {
      interpretation =
        `Delivery is slowing (${symptoms[0]}), but no single cause stands out from the data yet. `
        + 'Keep observing before acting.';
    } else if (primary.id === 'team_capacity') {
      interpretation =
        `Delivery is slowing (${symptoms[0]}). External factors (review, validation, process) look weak, `
        + 'so the constraint may be capacity — but verify workload and focus before questioning performance.';
    } else {
      interpretation =
        `Delivery is slowing (${symptoms[0]}). The most plausible explanation is: ${primary.question.replace(/^Is /, '').replace(/\?$/, '')} — ${primary.reasoning} `
        + 'Address this before questioning team performance.';
    }
  }

  // --- Findings (stored as pending insights) ---
  const findings: AiRecommendation[] = [{
    type: 'brain_interpretation',
    severity: deliverySlow ? 'warning' : 'info',
    title: deliverySlow ? 'Nibras Brain: delivery is slowing' : 'Nibras Brain: delivery looks normal',
    message: interpretation,
  }];
  for (const hypothesis of hypotheses) {
    if (hypothesis.verdict !== 'likely') continue;
    findings.push({
      type: `brain_cause_${hypothesis.id}`,
      severity: 'warning',
      title: `Probable cause: ${hypothesis.question.replace(/\?$/, '')}`,
      message: `${hypothesis.reasoning} Validate this interpretation and act on it if it matches reality.`,
    });
  }
  findings.sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  return {
    deliverySlow,
    symptoms,
    hypotheses,
    interpretation,
    findings,
    metrics: {
      windowDays,
      activeTasks: activeTasks.length,
      completedInWindow: doneInWindow.length,
      adtDays: round(adtDays, 1),
      delayRatePct: Math.round(delayRate * 100),
      overdueRatioPct: Math.round(overdueRatio * 100),
      inReview: reviewTasks.length,
      avgReviewAgeDays: round(avgReviewAgeDays, 1),
      reviewExitsInWindow,
      blockers,
      reworkPct: Math.round(reworkRatio * 100),
      silentOverloadCount: overloadedMembers.length,
    },
  };
}
