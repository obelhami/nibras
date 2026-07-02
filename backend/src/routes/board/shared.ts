import { db } from '../../../db';
import { verifyAuthToken } from '../../lib/jwt';
import { hasPermission } from '../../lib/permissions';

// ---------- types ----------

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: string | null;
};

export type BoardRow = {
  id: string;
  title: string;
  source: string;
  linked_project: string | null;
  linked_project_name: string | null;
  visibility: string;
  team_id: string | null;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

export type ColumnRow = {
  id: string;
  board_id: string;
  name: string;
  slug: string;
  position: number;
};

export type TaskRow = {
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
  assignee_id: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

export type TaskWithColumn = TaskRow & {
  column_name: string;
  column_slug: string;
  column_position: number;
};

// ---------- constants ----------

export const DEFAULT_COLUMNS = ['Todo', 'Doing', 'Review', 'Done'];
export const VISIBILITIES = new Set(['private', 'team', 'public']);
export const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

// ---------- small utils ----------

export function slugifyColumnName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'column';
}

export function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

// ---------- auth ----------

export async function getCurrentUser(authorization: string | undefined): Promise<AuthUser | null> {
  const payload = verifyAuthToken(authorization);

  if (!payload || payload.purpose === 'verification') {
    return null;
  }

  const result = await db.execute({
    sql: 'SELECT id, username, email, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const row = result.rows[0] as { id: number | string; username: string; email: string; role: string | null } | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
    role: row.role ?? (typeof payload.role === 'string' ? payload.role : null),
  };
}

// ---------- queries ----------

export async function getBoard(boardId: string) {
  const result = await db.execute({
    sql: `
      SELECT boards.*, projects.name AS linked_project_name
      FROM boards
      LEFT JOIN projects ON projects.id = boards.linked_project
      WHERE boards.id = ?
    `,
    args: [boardId],
  });

  return result.rows[0] as BoardRow | undefined;
}

export async function getProjectById(projectId: string) {
  const result = await db.execute({
    sql: 'SELECT id, name FROM projects WHERE id = ?',
    args: [projectId],
  });

  return result.rows[0] as { id: string; name: string } | undefined;
}

/**
 * Resolve a user by id only if they belong to the given team.
 * Returns the member (id + email) or undefined if not a member of that team.
 * Used to scope task assignment to the board's team.
 */
export async function resolveTeamMember(teamId: string, memberId: string) {
  const result = await db.execute({
    sql: `
      SELECT users.id, users.email
      FROM users
      JOIN team_members ON team_members.user_id = users.id
      WHERE team_members.team_id = ? AND users.id = ?
      LIMIT 1
    `,
    args: [teamId, memberId],
  });

  const row = result.rows[0] as { id: number | string; email: string } | undefined;
  return row ? { id: String(row.id), email: row.email } : undefined;
}

export async function getBoardColumns(boardId: string) {
  const result = await db.execute({
    sql: 'SELECT * FROM board_columns WHERE board_id = ? ORDER BY position ASC, created_at ASC',
    args: [boardId],
  });

  return result.rows as unknown as ColumnRow[];
}

export async function getBoardTasks(boardId: string) {
  const result = await db.execute({
    sql: `
      SELECT
        tasks.*,
        board_columns.name AS column_name,
        board_columns.slug AS column_slug,
        board_columns.position AS column_position
      FROM tasks
      JOIN board_columns ON board_columns.id = tasks.column_id
      WHERE tasks.board_id = ?
      ORDER BY board_columns.position ASC, tasks.created_at ASC
    `,
    args: [boardId],
  });

  return result.rows as unknown as TaskWithColumn[];
}

// ---------- access control ----------

async function userHasTeamAccess(board: BoardRow, userId: string) {
  if (!board.team_id) {
    return false;
  }

  const result = await db.execute({
    sql: 'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1',
    args: [board.team_id, userId],
  });

  return result.rows.length > 0;
}

async function canAccessBoard(board: BoardRow, user: AuthUser) {
  if (board.owner_email === user.email || user.role === 'admin' || user.role === 'manager') {
    return true;
  }

  if (board.visibility === 'public') {
    return true;
  }

  return userHasTeamAccess(board, user.id);
}

async function canManageBoard(board: BoardRow, user: AuthUser) {
  if (board.owner_email === user.email) {
    return true;
  }

  return hasPermission(user.role, 'create_board');
}

export async function getAccessibleBoard(boardId: string, user: AuthUser) {
  const board = await getBoard(boardId);
  if (!board) {
    return { error: 'Board not found', status: 404 as const };
  }

  const allowed = await canAccessBoard(board, user);
  if (!allowed) {
    return { error: 'Forbidden', status: 403 as const };
  }

  return { board };
}

export async function getManageableBoard(boardId: string, user: AuthUser) {
  const board = await getBoard(boardId);
  if (!board) {
    return { error: 'Board not found', status: 404 as const };
  }

  const allowed = await canManageBoard(board, user);
  if (!allowed) {
    return { error: 'Forbidden', status: 403 as const };
  }

  return { board };
}
