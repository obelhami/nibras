import crypto from 'crypto';
import { db } from '../../../db';
import { getBoard, getBoardColumns, getBoardTasks } from './shared';

/**
 * Recompute a board's metrics + task signals and persist them.
 * Called after any change that affects board state (task/column create, move, edit...).
 */
export async function recalculateBoardState(boardId: string) {
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const columns = await getBoardColumns(boardId);
  const tasks = await getBoardTasks(boardId);

  const columnStats = columns.map((column) => ({
    id: column.id,
    name: column.name,
    slug: column.slug,
    position: column.position,
    taskCount: tasks.filter((task) => task.column_id === column.id).length,
  }));

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((task) => task.status_slug === 'done').length;
  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status_slug === 'done') {
      return false;
    }

    return new Date(task.due_date).getTime() < Date.now();
  }).length;
  const unassignedTasks = tasks.filter((task) => !task.assignee_email).length;
  const averageComplexity = tasks.length === 0
    ? 0
    : Number((tasks.reduce((sum, task) => sum + (task.complexity ?? 0), 0) / tasks.length).toFixed(2));

  const signals: Array<{
    taskId: string;
    signalType: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
  }> = [];

  for (const task of tasks) {
    const details: Record<string, unknown> = {
      taskId: task.id,
      status: task.status_slug,
      columnId: task.column_id,
    };

    if (!task.assignee_email && (task.complexity ?? 0) >= 4) {
      signals.push({
        taskId: task.id,
        signalType: 'unassigned_high_complexity',
        severity: 'high',
        message: `Task "${task.title}" is unassigned and high complexity`,
        details,
      });
    }

    if (task.due_date) {
      const dueDate = new Date(task.due_date).getTime();
      const diffInDays = (dueDate - Date.now()) / (1000 * 60 * 60 * 24);

      if (task.status_slug !== 'done' && diffInDays < 0) {
        signals.push({
          taskId: task.id,
          signalType: 'overdue',
          severity: 'critical',
          message: `Task "${task.title}" is overdue`,
          details,
        });
      } else if (task.status_slug !== 'done' && diffInDays <= 2) {
        signals.push({
          taskId: task.id,
          signalType: 'deadline_risk',
          severity: 'medium',
          message: `Task "${task.title}" is due soon`,
          details,
        });
      }
    }
  }

  const metricsPayload = {
    boardId,
    title: board.title,
    totalTasks,
    doneTasks,
    completionRate: totalTasks === 0 ? 0 : Number(((doneTasks / totalTasks) * 100).toFixed(2)),
    overdueTasks,
    unassignedTasks,
    averageComplexity,
    byColumn: columnStats,
    generatedAt: new Date().toISOString(),
  };

  await db.execute({
    sql: 'DELETE FROM task_signals WHERE board_id = ?',
    args: [boardId],
  });

  for (const signal of signals) {
    await db.execute({
      sql: `
        INSERT INTO task_signals (id, board_id, task_id, signal_type, severity, message, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        crypto.randomUUID(),
        boardId,
        signal.taskId,
        signal.signalType,
        signal.severity,
        signal.message,
        JSON.stringify(signal.details),
      ],
    });
  }

  await db.execute({
    sql: `
      INSERT INTO board_metrics (board_id, payload, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(board_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [boardId, JSON.stringify(metricsPayload)],
  });

  return {
    metrics: metricsPayload,
    signals,
  };
}
