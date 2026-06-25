import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { db } from '../../../db';
import { hasPermission } from '../../lib/permissions';
import { recalculateBoardState } from './metrics';
import {
  DEFAULT_COLUMNS,
  VISIBILITIES,
  type BoardRow,
  type ColumnRow,
  getAccessibleBoard,
  getBoardColumns,
  getBoardTasks,
  getCurrentUser,
  getManageableBoard,
  getProjectById,
  normalizeText,
  slugifyColumnName,
} from './shared';

export default new Elysia()
  .get('/boards', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const result = await db.execute({
      sql: `
        SELECT DISTINCT boards.*, projects.name AS linked_project_name
        FROM boards
        LEFT JOIN team_members ON team_members.team_id = boards.team_id AND team_members.user_id = ?
        LEFT JOIN projects ON projects.id = boards.linked_project
        WHERE boards.owner_email = ?
          OR boards.visibility = 'public'
          OR team_members.user_id IS NOT NULL
        ORDER BY boards.updated_at DESC, boards.created_at DESC
      `,
      args: [user.id, user.email],
    });

    const boards = result.rows as unknown as BoardRow[];
    const enrichedBoards = [] as Array<BoardRow & { columns: ColumnRow[]; taskCount: number }>;

    for (const board of boards) {
      const columns = await getBoardColumns(board.id);
      const taskCountResult = await db.execute({
        sql: 'SELECT COUNT(*) AS count FROM tasks WHERE board_id = ?',
        args: [board.id],
      });

      const taskCountRow = taskCountResult.rows[0] as { count: number | string } | undefined;

      enrichedBoards.push({
        ...board,
        columns,
        taskCount: Number(taskCountRow?.count ?? 0),
      });
    }

    return { boards: enrichedBoards };
  })

  .post('/boards', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!hasPermission(user.role, 'create_board')) {
      set.status = 403;
      return { message: 'You do not have permission to create boards' };
    }

    const title = normalizeText(body.title);
    if (!title) {
      set.status = 400;
      return { message: 'Board title is required' };
    }

    const visibility = normalizeText(body.visibility) || 'private';
    if (!VISIBILITIES.has(visibility)) {
      set.status = 400;
      return { message: 'Visibility must be private, team, or public' };
    }

    const source = normalizeText(body.source) || 'manual';
    const linkedProject = normalizeText(body.linkedProject) || null;

    // Every board must belong to a team — task assignment is scoped to its members.
    const teamId = normalizeText(body.teamId);
    if (!teamId) {
      set.status = 400;
      return { message: 'A board must be assigned to a team' };
    }

    let linkedProjectName: string | null = null;
    if (linkedProject) {
      const project = await getProjectById(linkedProject);
      if (!project) {
        set.status = 404;
        return { message: 'Linked project not found' };
      }
      linkedProjectName = project.name;
    }

    const teamResult = await db.execute({
      sql: 'SELECT id, manager_id FROM teams WHERE id = ?',
      args: [teamId],
    });

    const teamRow = teamResult.rows[0] as { id: string; manager_id: string } | undefined;
    if (!teamRow) {
      set.status = 404;
      return { message: 'Team not found' };
    }

    if (teamRow.manager_id !== user.id && user.role !== 'admin') {
      set.status = 403;
      return { message: 'Only the team manager or admin can attach a team board' };
    }

    const boardId = crypto.randomUUID();
    await db.execute({
      sql: `
        INSERT INTO boards (id, title, source, linked_project, visibility, team_id, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [boardId, title, source, linkedProject, visibility, teamId, user.email],
    });

    const requestedColumns = Array.isArray(body.columns) && body.columns.length > 0
      ? body.columns
      : DEFAULT_COLUMNS;

    const normalizedColumns = [] as Array<{ name: string; slug: string }>;
    const seenSlugs = new Set<string>();

    for (const rawColumn of requestedColumns) {
      const name = normalizeText(rawColumn);
      if (!name) {
        continue;
      }

      const slug = slugifyColumnName(name);
      if (seenSlugs.has(slug)) {
        continue;
      }

      seenSlugs.add(slug);
      normalizedColumns.push({ name, slug });
    }

    if (normalizedColumns.length === 0) {
      normalizedColumns.push(...DEFAULT_COLUMNS.map((name) => ({ name, slug: slugifyColumnName(name) })));
    }

    const createdColumns = [] as ColumnRow[];

    for (let index = 0; index < normalizedColumns.length; index += 1) {
      const column = normalizedColumns[index]!;
      const columnId = crypto.randomUUID();

      await db.execute({
        sql: `
          INSERT INTO board_columns (id, board_id, name, slug, position)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [columnId, boardId, column.name, column.slug, index],
      });

      createdColumns.push({
        id: columnId,
        board_id: boardId,
        name: column.name,
        slug: column.slug,
        position: index,
      });
    }

    const snapshot = await recalculateBoardState(boardId);

    return {
      message: 'Board created successfully',
      board: {
        id: boardId,
        title,
        source,
        linkedProject,
        linkedProjectName,
        visibility,
        teamId,
        ownerEmail: user.email,
      },
      columns: createdColumns,
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.String(),
      source: t.Optional(t.String()),
      linkedProject: t.Optional(t.String()),
      visibility: t.Optional(t.String()),
      teamId: t.Optional(t.String()),
      columns: t.Optional(t.Array(t.String())),
    }),
  })

  .get('/boards/:boardId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const columns = await getBoardColumns(params.boardId);
    const tasks = await getBoardTasks(params.boardId);
    const metricsResult = await db.execute({
      sql: 'SELECT payload FROM board_metrics WHERE board_id = ?',
      args: [params.boardId],
    });
    const metricsRow = metricsResult.rows[0] as { payload: string } | undefined;
    const signalsResult = await db.execute({
      sql: 'SELECT * FROM task_signals WHERE board_id = ? ORDER BY created_at DESC',
      args: [params.boardId],
    });

    return {
      board: boardAccess.board,
      columns,
      tasks,
      metrics: metricsRow?.payload ? JSON.parse(metricsRow.payload) : null,
      signals: signalsResult.rows,
    };
  })

  .patch('/boards/:boardId', async ({ headers, params, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const updates: string[] = [];
    const values: Array<string | null> = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) {
        set.status = 400;
        return { message: 'Board title cannot be empty' };
      }

      updates.push('title = ?');
      values.push(title);
    }

    if (typeof body.source === 'string') {
      updates.push('source = ?');
      values.push(body.source.trim() || 'manual');
    }

    if (typeof body.linkedProject === 'string') {
      const linkedProject = body.linkedProject.trim() || null;
      if (linkedProject) {
        const project = await getProjectById(linkedProject);
        if (!project) {
          set.status = 404;
          return { message: 'Linked project not found' };
        }
      }

      updates.push('linked_project = ?');
      values.push(linkedProject);
    }

    if (typeof body.visibility === 'string') {
      const visibility = body.visibility.trim();
      if (!VISIBILITIES.has(visibility)) {
        set.status = 400;
        return { message: 'Visibility must be private, team, or public' };
      }

      updates.push('visibility = ?');
      values.push(visibility);
    }

    if (typeof body.teamId === 'string') {
      const teamId = body.teamId.trim();
      // A board must always keep a team — it cannot be unset.
      if (!teamId) {
        set.status = 400;
        return { message: 'A board must be assigned to a team' };
      }

      const teamResult = await db.execute({
        sql: 'SELECT id, manager_id FROM teams WHERE id = ?',
        args: [teamId],
      });

      const teamRow = teamResult.rows[0] as { id: string; manager_id: string } | undefined;
      if (!teamRow) {
        set.status = 404;
        return { message: 'Team not found' };
      }

      if (teamRow.manager_id !== user.id && user.role !== 'admin') {
        set.status = 403;
        return { message: 'Only the team manager or admin can attach a team board' };
      }

      updates.push('team_id = ?');
      values.push(teamId);
    }

    if (updates.length === 0) {
      set.status = 400;
      return { message: 'No board changes provided' };
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    await db.execute({
      sql: `UPDATE boards SET ${updates.join(', ')} WHERE id = ?`,
      args: [...values, params.boardId],
    });

    const snapshot = await recalculateBoardState(params.boardId);

    return {
      message: 'Board updated successfully',
      metrics: snapshot?.metrics ?? null,
    };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      source: t.Optional(t.String()),
      linkedProject: t.Optional(t.String()),
      visibility: t.Optional(t.String()),
      teamId: t.Optional(t.String()),
    }),
  })

  .delete('/boards/:boardId', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getManageableBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    await db.execute({ sql: 'DELETE FROM task_signals WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM board_metrics WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM task_assignment_history WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: "DELETE FROM kpi_snapshots WHERE scope = 'board' AND scope_id = ?", args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM task_history WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM tasks WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM board_columns WHERE board_id = ?', args: [params.boardId] });
    await db.execute({ sql: 'DELETE FROM boards WHERE id = ?', args: [params.boardId] });

    return { message: 'Board deleted successfully' };
  })

  .get('/boards/:boardId/metrics', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    const snapshot = await recalculateBoardState(params.boardId);
    return {
      metrics: snapshot?.metrics ?? null,
      signals: snapshot?.signals ?? [],
    };
  })

  // Members of the board's team — used to populate the assignee dropdown.
  .get('/boards/:boardId/members', async ({ headers, params, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const boardAccess = await getAccessibleBoard(params.boardId, user);
    if ('error' in boardAccess) {
      set.status = boardAccess.status;
      return { message: boardAccess.error };
    }

    if (!boardAccess.board.team_id) {
      return { members: [] };
    }

    const result = await db.execute({
      sql: `
        SELECT users.id, users.username, users.email
        FROM team_members
        JOIN users ON users.id = team_members.user_id
        WHERE team_members.team_id = ?
        ORDER BY users.username ASC
      `,
      args: [boardAccess.board.team_id],
    });

    const members = (result.rows as unknown as Array<{ id: number | string; username: string; email: string }>)
      .map((row) => ({ id: String(row.id), username: row.username, email: row.email }));

    return { members };
  });
