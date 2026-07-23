import { db } from '../../db';

export type SilentOverloadResult = {
  signal?: 'silent_overload';
  confidence: number;
};

export type ReviewSaturationResult = {
  signal?: 'review_saturation';
  confidence: number;
};

export type ContributionStyle =
  | 'stabilizer'
  | 'accelerator'
  | 'firefighter'
  | 'silent_architect'
  | 'team_support'
  | 'debt_generator'
  | 'critical_problem_solver'
  | 'system_protector';

export type ContributionStyleResult = {
  style: ContributionStyle;
  confidence: number;
};

type UserRow = {
  id: number | string;
  email: string;
  username: string;
  role: string | null;
};

type TaskRow = {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: string;
  status_slug: string;
  due_date: string | null;
  complexity: number | null;
  assignee_email: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  board_title: string;
  board_linked_project: string | null;
  column_slug: string;
  column_name: string;
};

type TaskHistoryRow = {
  task_id: string;
  board_id: string;
  from_status_slug: string | null;
  to_status_slug: string | null;
  moved_by_email: string;
  note: string | null;
  created_at: string;
};

type BehavioralThresholds = {
  assignedTasks: number;
  overdueTasks: number;
  reviewStallDays: number;
  lateNightStartHour: number;
  lateNightEndHour: number;
  unstableActivityCv: number;
  reviewImbalanceRatio: number;
  reviewBacklogCount: number;
  styleLookbackDays: number;
};

const DEFAULT_THRESHOLDS: BehavioralThresholds = {
  assignedTasks: 10,
  overdueTasks: 3,
  reviewStallDays: 3,
  lateNightStartHour: 22,
  lateNightEndHour: 5,
  unstableActivityCv: 1.1,
  reviewImbalanceRatio: 1.8,
  reviewBacklogCount: 5,
  styleLookbackDays: 30,
};

const CRITICAL_KEYWORDS = ['critical', 'incident', 'outage', 'hotfix', 'sev', 'blocker'];
const FIX_KEYWORDS = ['fix', 'bug', 'defect', 'patch', 'repair', 'regression'];
const REVIEW_HELP_KEYWORDS = ['review', 'qa', 'unblock', 'pair', 'support'];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundConfidence(value: number) {
  return Number(clamp01(value).toFixed(2));
}

function normalizeRange(value: number, min: number, max: number) {
  if (max <= min) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
}

function hasKeyword(text: string | null | undefined, keywords: string[]) {
  if (!text) {
    return false;
  }

  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword));
}

function getUtcHour(isoValue: string) {
  return new Date(isoValue).getUTCHours();
}

function getDayKey(isoValue: string) {
  return new Date(isoValue).toISOString().slice(0, 10);
}

function getDaysBetween(startIso: string, endIso: string) {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60 * 24);
}

function calculateMean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateStandardDeviation(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const mean = calculateMean(values);
  const variance = calculateMean(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function calculateSoftMaxConfidence(scores: Record<ContributionStyle, number>) {
  const entries = Object.entries(scores) as Array<[ContributionStyle, number]>;
  const maxScore = Math.max(...entries.map(([, score]) => score));
  const expScores = entries.map(([style, score]) => [style, Math.exp(score - maxScore)] as const);
  const total = expScores.reduce((sum, [, score]) => sum + score, 0);
  const normalized = expScores.map(([style, score]) => [style, score / total] as const);
  normalized.sort((left, right) => right[1] - left[1]);

  const [topStyle, topProbability] = normalized[0] ?? [entries[0]?.[0] ?? 'stabilizer', 0];
  const secondProbability = normalized[1]?.[1] ?? 0;
  const evidenceStrength = clamp01(maxScore);
  const margin = clamp01(topProbability - secondProbability);

  return {
    style: topStyle,
    confidence: roundConfidence(0.35 + topProbability * 0.35 + margin * 0.2 + evidenceStrength * 0.1),
  };
}

async function getUserById(userId: string) {
  const result = await db.execute({
    sql: 'SELECT id, email, username, role FROM users WHERE id = ? LIMIT 1',
    args: [userId],
  });

  return result.rows[0] as UserRow | undefined;
}

async function getAssignedTasksByEmail(email: string) {
  const result = await db.execute({
    sql: `
      SELECT
        tasks.*,
        boards.title AS board_title,
        boards.linked_project AS board_linked_project,
        board_columns.slug AS column_slug,
        board_columns.name AS column_name
      FROM tasks
      JOIN boards ON boards.id = tasks.board_id
      JOIN board_columns ON board_columns.id = tasks.column_id
      WHERE tasks.assignee_email = ?
      ORDER BY tasks.updated_at DESC, tasks.created_at DESC
    `,
    args: [email],
  });

  return result.rows as unknown as TaskRow[];
}

async function getTaskHistoryByTaskIds(taskIds: string[]) {
  if (taskIds.length === 0) {
    return [] as TaskHistoryRow[];
  }

  const placeholders = taskIds.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `
      SELECT task_id, board_id, from_status_slug, to_status_slug, moved_by_email, note, created_at
      FROM task_history
      WHERE task_id IN (${placeholders})
      ORDER BY created_at ASC
    `,
    args: taskIds,
  });

  return result.rows as unknown as TaskHistoryRow[];
}

async function getActivityHistoryForEmail(email: string, lookbackDays: number) {
  const result = await db.execute({
    sql: `
      SELECT task_id, board_id, from_status_slug, to_status_slug, moved_by_email, note, created_at
      FROM task_history
      WHERE moved_by_email = ?
        AND created_at >= datetime('now', ?)
      ORDER BY created_at ASC
    `,
    args: [email, `-${lookbackDays} days`],
  });

  return result.rows as unknown as TaskHistoryRow[];
}

async function getProjectReviewTasks(projectId: string) {
  const result = await db.execute({
    sql: `
      SELECT
        tasks.*,
        boards.title AS board_title,
        boards.linked_project AS board_linked_project,
        board_columns.slug AS column_slug,
        board_columns.name AS column_name
      FROM tasks
      JOIN boards ON boards.id = tasks.board_id
      JOIN board_columns ON board_columns.id = tasks.column_id
      WHERE boards.linked_project = ?
        AND tasks.status_slug = 'review'
      ORDER BY tasks.updated_at DESC, tasks.created_at DESC
    `,
    args: [projectId],
  });

  return result.rows as unknown as TaskRow[];
}

function getReviewEntryTimes(history: TaskHistoryRow[]) {
  const reviewEntryByTaskId = new Map<string, TaskHistoryRow>();

  for (const row of history) {
    if (row.to_status_slug !== 'review') {
      continue;
    }

    const previous = reviewEntryByTaskId.get(row.task_id);
    if (!previous || new Date(row.created_at).getTime() > new Date(previous.created_at).getTime()) {
      reviewEntryByTaskId.set(row.task_id, row);
    }
  }

  return reviewEntryByTaskId;
}

function analyzeActivityPattern(activityHistory: TaskHistoryRow[], thresholds = DEFAULT_THRESHOLDS) {
  const lateNightActions = activityHistory.filter((row) => {
    const hour = getUtcHour(row.created_at);
    return hour >= thresholds.lateNightStartHour || hour <= thresholds.lateNightEndHour;
  });

  const dailyCounts = new Map<string, number>();
  for (const row of activityHistory) {
    const dayKey = getDayKey(row.created_at);
    dailyCounts.set(dayKey, (dailyCounts.get(dayKey) ?? 0) + 1);
  }

  const orderedDays = [...dailyCounts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const counts = orderedDays.map(([, count]) => count);
  const mean = calculateMean(counts);
  const standardDeviation = calculateStandardDeviation(counts);
  const coefficientOfVariation = mean === 0 ? 0 : standardDeviation / mean;

  let longestGapDays = 0;
  for (let index = 1; index < orderedDays.length; index += 1) {
    const previousDayKey = orderedDays[index - 1]?.[0];
    const currentDayKey = orderedDays[index]?.[0];

    if (!previousDayKey || !currentDayKey) {
      continue;
    }

    const previousDay = new Date(`${previousDayKey}T00:00:00.000Z`).getTime();
    const currentDay = new Date(`${currentDayKey}T00:00:00.000Z`).getTime();
    const gapDays = (currentDay - previousDay) / (1000 * 60 * 60 * 24) - 1;
    longestGapDays = Math.max(longestGapDays, gapDays);
  }

  const unstableByVolatility = activityHistory.length >= 6 && coefficientOfVariation >= thresholds.unstableActivityCv;
  const unstableByGaps = activityHistory.length >= 8 && longestGapDays >= 4;

  return {
    unstable: unstableByVolatility || unstableByGaps,
    coefficientOfVariation,
    lateNightCount: lateNightActions.length,
    lateNightRatio: activityHistory.length === 0 ? 0 : lateNightActions.length / activityHistory.length,
  };
}

function getTaskReviewAgeDays(task: TaskRow, historyByTaskId: Map<string, TaskHistoryRow>) {
  const reviewEntry = historyByTaskId.get(task.id);
  const referenceTime = reviewEntry?.created_at ?? task.updated_at ?? task.created_at;
  return getDaysBetween(referenceTime, new Date().toISOString());
}

function getTaskCycleDays(task: TaskRow, history: TaskHistoryRow[]) {
  const completionEntry = [...history]
    .reverse()
    .find((row) => row.task_id === task.id && row.to_status_slug === 'done');

  if (!completionEntry) {
    return null;
  }

  return getDaysBetween(task.created_at, completionEntry.created_at);
}

function buildStyleFeatures(tasks: TaskRow[], history: TaskHistoryRow[], email: string) {
  const doneTasks = tasks.filter((task) => task.status_slug === 'done');
  const urgentTasks = tasks.filter((task) => ['high', 'urgent'].includes(task.priority.toLowerCase()));
  const complexityTasks = tasks.filter((task) => (task.complexity ?? 0) >= 4);

  const reviewParticipation = history.filter((row) => {
    if (row.moved_by_email !== email) {
      return false;
    }

    return row.to_status_slug === 'review' || row.from_status_slug === 'review' || hasKeyword(row.note, REVIEW_HELP_KEYWORDS);
  });

  const criticalTasks = tasks.filter((task) =>
    hasKeyword(task.title, CRITICAL_KEYWORDS) || hasKeyword(task.description, CRITICAL_KEYWORDS),
  );
  const fixTasks = tasks.filter((task) =>
    hasKeyword(task.title, FIX_KEYWORDS) || hasKeyword(task.description, FIX_KEYWORDS),
  );

  const reopenedByUser = history.filter((row) =>
    row.moved_by_email === email && row.from_status_slug === 'done' && row.to_status_slug !== 'done',
  ).length;

  const reviewTaskCount = tasks.filter((task) => task.status_slug === 'review').length;
  const overdueCount = tasks.filter((task) => {
    if (!task.due_date || task.status_slug === 'done') {
      return false;
    }

    return new Date(task.due_date).getTime() < Date.now();
  }).length;

  const cycleDays = doneTasks
    .map((task) => getTaskCycleDays(task, history))
    .filter((value): value is number => typeof value === 'number');

  const averageCycleDays = calculateMean(cycleDays);
  const speedScore = clamp01(1 - normalizeRange(averageCycleDays, 0, 10));

  return {
    completionScore: normalizeRange(doneTasks.length, 0, 15),
    urgentRatio: tasks.length === 0 ? 0 : urgentTasks.length / tasks.length,
    complexityScore: tasks.length === 0 ? 0 : complexityTasks.reduce((sum, task) => sum + (task.complexity ?? 0), 0) / (tasks.length * 5),
    reviewParticipationScore: history.length === 0 ? 0 : reviewParticipation.length / history.length,
    reopenedRatio: doneTasks.length === 0 ? 0 : reopenedByUser / doneTasks.length,
    criticalRatio: tasks.length === 0 ? 0 : criticalTasks.length / tasks.length,
    fixRatio: tasks.length === 0 ? 0 : fixTasks.length / tasks.length,
    speedScore,
    consistencyScore: 1 - normalizeRange(calculateStandardDeviation(cycleDays), 0, 7),
    backlogRatio: tasks.length === 0 ? 0 : overdueCount / tasks.length,
    reviewThroughput: tasks.length === 0 ? 0 : reviewTaskCount / tasks.length,
    lowPriorityRatio: tasks.length === 0 ? 0 : tasks.filter((task) => task.priority.toLowerCase() === 'low').length / tasks.length,
  };
}

export async function detectSilentOverload(userId: string, thresholds = DEFAULT_THRESHOLDS): Promise<SilentOverloadResult> {
  const user = await getUserById(userId);

  if (!user) {
    return { confidence: 0 };
  }

  const tasks = await getAssignedTasksByEmail(user.email);
  const history = await getActivityHistoryForEmail(user.email, thresholds.styleLookbackDays);
  const reviewTasks = tasks.filter((task) => task.status_slug === 'review');
  const reviewEntryTimes = getReviewEntryTimes(await getTaskHistoryByTaskIds(tasks.map((task) => task.id)));

  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status_slug === 'done') {
      return false;
    }

    return new Date(task.due_date).getTime() < Date.now();
  });

  const blockedReviews = reviewTasks.filter((task) => getTaskReviewAgeDays(task, reviewEntryTimes) > thresholds.reviewStallDays);
  const activityPattern = analyzeActivityPattern(history, thresholds);

  let score = 0;
  score += normalizeRange(tasks.length, thresholds.assignedTasks, thresholds.assignedTasks + 15) * 0.3;
  score += normalizeRange(overdueTasks.length, thresholds.overdueTasks, thresholds.overdueTasks + 10) * 0.25;
  score += normalizeRange(blockedReviews.length, 1, 6) * 0.15;
  score += activityPattern.unstable ? 0.15 : 0;
  score += normalizeRange(activityPattern.lateNightRatio, 0.15, 0.45) * 0.15;

  console.log("========== REVIEW ANALYSIS ==========");

for (const task of reviewTasks) {
    const history = reviewEntryTimes.get(task.id);

    console.log({
        id: task.id,
        title: task.title,
        hasReviewHistory: !!history,
        reviewEnteredAt: history?.created_at ?? null,
        updatedAt: task.updated_at,
        createdAt: task.created_at,
        reviewAge: getTaskReviewAgeDays(task, reviewEntryTimes),
        blocked:
            getTaskReviewAgeDays(task, reviewEntryTimes) >
            thresholds.reviewStallDays,
    });
}

console.log("=====================================");

  const confidence = roundConfidence(score);

  if (confidence < 0.7) {
    return { confidence };
  }

  return {
    signal: 'silent_overload',
    confidence,
  };
}

export async function detectReviewSaturation(projectId: string, thresholds = DEFAULT_THRESHOLDS): Promise<ReviewSaturationResult> {
  const reviewTasks = await getProjectReviewTasks(projectId);

  if (reviewTasks.length === 0) {
    return { confidence: 0 };
  }

  const history = await getTaskHistoryByTaskIds(reviewTasks.map((task) => task.id));
  const reviewEntryTimes = getReviewEntryTimes(history);

  const waitingTimes = reviewTasks.map((task) => getTaskReviewAgeDays(task, reviewEntryTimes));
  const stuckReviewTasks = waitingTimes.filter((waitTime) => waitTime > thresholds.reviewStallDays);

  const reviewerCounts = new Map<string, number>();
  for (const [taskId, entry] of reviewEntryTimes.entries()) {
    const task = reviewTasks.find((candidate) => candidate.id === taskId);
    if (!task || !entry.moved_by_email) {
      continue;
    }

    reviewerCounts.set(entry.moved_by_email, (reviewerCounts.get(entry.moved_by_email) ?? 0) + 1);
  }

  const reviewerLoads = [...reviewerCounts.values()];
  const averageLoad = calculateMean(reviewerLoads);
  const maxLoad = reviewerLoads.length === 0 ? 0 : Math.max(...reviewerLoads);
  const workloadImbalance = averageLoad === 0 ? 0 : maxLoad / averageLoad;
  const averageWaitDays = calculateMean(waitingTimes);

  let score = 0;
  score += normalizeRange(reviewTasks.length, thresholds.reviewBacklogCount, thresholds.reviewBacklogCount + 15) * 0.35;
  score += normalizeRange(stuckReviewTasks.length, 1, Math.max(4, reviewTasks.length)) * 0.3;
  score += normalizeRange(averageWaitDays, thresholds.reviewStallDays, thresholds.reviewStallDays + 7) * 0.2;
  score += normalizeRange(workloadImbalance, thresholds.reviewImbalanceRatio, thresholds.reviewImbalanceRatio + 1.75) * 0.15;


  const confidence = roundConfidence(score);

  if (confidence < 0.7) {
    return { confidence };
  }

  return {
    signal: 'review_saturation',
    confidence,
  };
}

export async function analyzeContributionStyle(userId: string): Promise<ContributionStyleResult> {
  const user = await getUserById(userId);

  if (!user) {
    return {
      style: 'stabilizer',
      confidence: 0,
    };
  }

  const tasks = await getAssignedTasksByEmail(user.email);
  const history = await getTaskHistoryByTaskIds(tasks.map((task) => task.id));
  const features = buildStyleFeatures(tasks, history, user.email);

  const scores: Record<ContributionStyle, number> = {
    stabilizer:
      features.completionScore * 0.35 +
      (1 - features.reopenedRatio) * 0.25 +
      features.consistencyScore * 0.15 +
      features.reviewParticipationScore * 0.1 +
      (1 - features.urgentRatio) * 0.15,
    accelerator:
      features.completionScore * 0.35 +
      features.speedScore * 0.25 +
      features.urgentRatio * 0.2 +
      features.reviewThroughput * 0.1 +
      features.consistencyScore * 0.1,
    firefighter:
      (features.criticalRatio + features.urgentRatio + features.backlogRatio) * 0.35 +
      features.reopenedRatio * 0.15 +
      features.completionScore * 0.15 +
      features.speedScore * 0.15 +
      features.reviewThroughput * 0.2,
    silent_architect:
      features.complexityScore * 0.35 +
      features.urgentRatio * 0.2 +
      (1 - features.reviewParticipationScore) * 0.2 +
      features.completionScore * 0.15 +
      (1 - features.reopenedRatio) * 0.1,
    team_support:
      features.reviewParticipationScore * 0.35 +
      features.reviewThroughput * 0.2 +
      features.completionScore * 0.15 +
      (1 - features.urgentRatio) * 0.15 +
      (1 - features.reopenedRatio) * 0.15,
    debt_generator:
      features.reopenedRatio * 0.4 +
      (1 - features.completionScore) * 0.2 +
      (1 - features.consistencyScore) * 0.15 +
      features.lowPriorityRatio * 0.1 +
      features.backlogRatio * 0.15,
    critical_problem_solver:
      features.criticalRatio * 0.3 +
      features.fixRatio * 0.25 +
      features.urgentRatio * 0.2 +
      features.completionScore * 0.15 +
      features.speedScore * 0.1,
    // System Protector (CDC §15): "keeps the system alive despite
    // constraints and chaos" — stays consistent under pressure, handles
    // complex/legacy work, fixes what's broken, and keeps the backlog from
    // spiraling, without necessarily topping raw completion volume.
    system_protector:
      features.consistencyScore * 0.3 +
      (1 - features.reopenedRatio) * 0.2 +
      features.complexityScore * 0.2 +
      features.fixRatio * 0.15 +
      (1 - features.backlogRatio) * 0.15,
  };

  const { style, confidence } = calculateSoftMaxConfidence(scores);

  return {
    style,
    confidence: roundConfidence(confidence),
  };
}