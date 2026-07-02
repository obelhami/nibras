/**
 * KPI Engine — Module 6
 *
 * Pure "Metric Computation" functions. They take already-aggregated rows
 * (fetched by the Aggregation Engine = SQL queries in routes/kpi.ts) and turn
 * raw task activity into analytics. Keeping them pure makes them easy to test
 * and easy to reason about in review.
 *
 * Convention: a board column whose slug is `done` means "delivered/released",
 * and `review` means "in validation". Default boards already use these slugs.
 */

const DONE = 'done';
const REVIEW = 'review';

export type KpiTaskRow = {
  id: string;
  status_slug: string;
  due_date: string | null;
  complexity: number | null;
  assignee_email: string | null;
  created_at: string;
  updated_at: string;
};

export type KpiHistoryRow = {
  task_id: string;
  from_status_slug: string | null;
  to_status_slug: string | null;
  from_position: number | null;
  to_position: number | null;
  moved_by_email: string;
  note: string | null;
  created_at: string;
};

// ---------- small helpers ----------

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

function isBlockerNote(note: string | null): boolean {
  return !!note && /block/i.test(note);
}

/** First time each task entered a given status (earliest matching history row). */
function firstReachedAt(history: KpiHistoryRow[], status: string): Map<string, string> {
  const reached = new Map<string, string>();
  for (const row of history) {
    if (row.to_status_slug === status && !reached.has(row.task_id)) {
      reached.set(row.task_id, row.created_at);
    }
  }
  return reached;
}

// ---------- KPI-01: Operational KPIs (board scope) ----------

/**
 * ADT  — Average Delivery Time: avg hours from task creation to first "done".
 * VRR  — Validation & Release Rate: of tasks that entered review, how many
 *        were released (reached done). Falls back to done/total if a board
 *        does not use a review stage.
 * ERR  — Error Rate Ratio: share of column moves that went backwards (rework).
 * Review Saturation — share of active (not-done) tasks currently in review.
 */
export function computeOperationalKpis(tasks: KpiTaskRow[], history: KpiHistoryRow[]) {
  const createdAtByTask = new Map(tasks.map((task) => [task.id, task.created_at]));

  // ADT
  const doneAtByTask = firstReachedAt(history, DONE);
  const deliveryHours: number[] = [];
  for (const [taskId, doneAt] of doneAtByTask) {
    const createdAt = createdAtByTask.get(taskId);
    if (createdAt) deliveryHours.push(hoursBetween(createdAt, doneAt));
  }
  const adtHours = avg(deliveryHours);

  // VRR
  const reachedReview = new Set<string>();
  const reachedDone = new Set<string>();
  for (const row of history) {
    if (row.to_status_slug === REVIEW) reachedReview.add(row.task_id);
    if (row.to_status_slug === DONE) reachedDone.add(row.task_id);
  }
  const validatedCount = reachedReview.size;
  const releasedAfterReview = [...reachedReview].filter((id) => reachedDone.has(id)).length;
  const vrr = validatedCount > 0
    ? releasedAfterReview / validatedCount
    : (tasks.length > 0 ? reachedDone.size / tasks.length : 0);

  // ERR (only real moves have both positions; creation rows have null from_position)
  let totalMoves = 0;
  let backwardMoves = 0;
  for (const row of history) {
    if (row.from_position == null || row.to_position == null) continue;
    totalMoves += 1;
    if (row.to_position < row.from_position) backwardMoves += 1;
  }
  const err = totalMoves > 0 ? backwardMoves / totalMoves : 0;

  // Review saturation
  const activeTasks = tasks.filter((task) => task.status_slug !== DONE);
  const inReview = tasks.filter((task) => task.status_slug === REVIEW);
  const reviewSaturation = activeTasks.length > 0 ? inReview.length / activeTasks.length : 0;

  return {
    adtHours: round(adtHours),
    adtDays: round(adtHours / 24),
    vrr: round(vrr * 100),                 // %
    err: round(err * 100),                 // %
    reviewSaturation: round(reviewSaturation * 100), // %
    totals: {
      totalTasks: tasks.length,
      completedTasks: reachedDone.size,
      activeTasks: activeTasks.length,
      inReview: inReview.length,
      validatedTasks: validatedCount,
      backwardMoves,
      totalMoves,
    },
  };
}

// ---------- KPI-02: Focus Score (user scope) ----------

function focusLabel(score: number): string {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/**
 * Focus Score (0–100, higher = more focused/stable). Starts at 100 and
 * subtracts capped penalties for each instability indicator from the spec:
 * too many context switches, many unfinished tasks, frequent blockers,
 * excessive reassignment.
 *
 * @param userMoves      task_history rows where moved_by_email = user, time-ordered.
 * @param assignedTasks  current tasks where assignee_email = user.
 * @param reassignments  count of reassignments touching this user (from history table).
 */
export function computeFocusScore(
  email: string,
  assignedTasks: KpiTaskRow[],
  userMoves: KpiHistoryRow[],
  reassignments: number,
) {
  // Context switches: consecutive moves landing on a different task.
  let contextSwitches = 0;
  for (let i = 1; i < userMoves.length; i += 1) {
    if (userMoves[i]!.task_id !== userMoves[i - 1]!.task_id) contextSwitches += 1;
  }

  const unfinishedTasks = assignedTasks.filter((task) => task.status_slug !== DONE).length;
  const blockers = userMoves.filter((row) => isBlockerNote(row.note)).length;

  const contextSwitchPenalty = Math.min(25, contextSwitches * 3);
  const unfinishedPenalty = Math.min(30, unfinishedTasks * 5);
  const blockerPenalty = Math.min(25, blockers * 5);
  const reassignmentPenalty = Math.min(20, reassignments * 5);

  const score = clamp(
    100 - contextSwitchPenalty - unfinishedPenalty - blockerPenalty - reassignmentPenalty,
    0,
    100,
  );

  return {
    email,
    score: Math.round(score),
    label: focusLabel(score),
    indicators: {
      contextSwitches,
      unfinishedTasks,
      blockers,
      reassignments,
      assignedTasks: assignedTasks.length,
      movesAnalyzed: userMoves.length,
    },
    penalties: {
      contextSwitchPenalty,
      unfinishedPenalty,
      blockerPenalty,
      reassignmentPenalty,
    },
  };
}

// ---------- KPI-03: Team Pulse (team scope) ----------

export type TeamPulseState = 'healthy' | 'overloaded' | 'unstable' | 'critical';

/**
 * Team Pulse — overall team health. Builds a 0–100 health score from workload,
 * blockers, delays, overdue tasks and review queues, then maps it to a state:
 *   healthy    — balanced and on track
 *   overloaded — too many tasks relative to capacity
 *   unstable   — inconsistent delivery rhythm
 *   critical   — immediate intervention needed
 *
 * @param memberCount number of people on the team (capacity).
 * @param now         injected current time (ms) for testability.
 */
export function computeTeamPulse(
  tasks: KpiTaskRow[],
  history: KpiHistoryRow[],
  memberCount: number,
  reassignments: number,
  now: number = Date.now(),
): { state: TeamPulseState; score: number; inputs: Record<string, number> } {
  const members = Math.max(memberCount, 1);
  const activeTasks = tasks.filter((task) => task.status_slug !== DONE);

  const overdueTasks = activeTasks.filter(
    (task) => task.due_date != null && new Date(task.due_date).getTime() < now,
  ).length;

  const inReview = tasks.filter((task) => task.status_slug === REVIEW).length;

  // Delays: tasks delivered after their due date.
  const doneAtByTask = firstReachedAt(history, DONE);
  const dueByTask = new Map(tasks.map((task) => [task.id, task.due_date]));
  let completed = 0;
  let delayed = 0;
  for (const [taskId, doneAt] of doneAtByTask) {
    completed += 1;
    const due = dueByTask.get(taskId);
    if (due && new Date(doneAt).getTime() > new Date(due).getTime()) delayed += 1;
  }

  const blockers = history.filter((row) => isBlockerNote(row.note)).length;

  const workloadPerMember = activeTasks.length / members;
  const overdueRatio = activeTasks.length > 0 ? overdueTasks / activeTasks.length : 0;
  const reviewSaturation = activeTasks.length > 0 ? inReview / activeTasks.length : 0;
  const delayRate = completed > 0 ? delayed / completed : 0;

  // Penalties (capped) → health score.
  const workloadPenalty = Math.min(30, Math.max(0, workloadPerMember - 3) * 8);
  const overduePenalty = Math.min(30, overdueRatio * 60);
  const reviewPenalty = Math.min(15, reviewSaturation * 30);
  const delayPenalty = Math.min(15, delayRate * 30);
  const blockerPenalty = Math.min(20, blockers * 4);

  const score = Math.round(
    clamp(100 - workloadPenalty - overduePenalty - reviewPenalty - delayPenalty - blockerPenalty, 0, 100),
  );

  let state: TeamPulseState;
  if (score < 40 || overdueRatio > 0.4) {
    state = 'critical';
  } else if (workloadPerMember > 5) {
    state = 'overloaded';
  } else if (delayRate > 0.3 || reviewSaturation > 0.5 || blockers >= 5) {
    state = 'unstable';
  } else {
    state = 'healthy';
  }

  return {
    state,
    score,
    inputs: {
      members,
      activeTasks: activeTasks.length,
      workloadPerMember: round(workloadPerMember),
      overdueTasks,
      overdueRatio: round(overdueRatio * 100),
      inReview,
      reviewSaturation: round(reviewSaturation * 100),
      completedTasks: completed,
      delayedTasks: delayed,
      delayRate: round(delayRate * 100),
      blockers,
      reassignments,
    },
  };
}
