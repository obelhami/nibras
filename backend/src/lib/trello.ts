import crypto from 'crypto';
import { db } from '../../db';
import { normalizeText, slugifyColumnName } from '../routes/board/shared';
import { recalculateBoardState } from '../routes/board/metrics';
import { logAuditEvent } from './audit';

const TRELLO_API_KEY = process.env.TRELLO_API_KEY ?? '';
const TRELLO_API_SECRET = process.env.TRELLO_API_SECRET ?? '';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const TRELLO_REQUEST_TOKEN_URL = 'https://trello.com/1/OAuthGetRequestToken';
const TRELLO_ACCESS_TOKEN_URL = 'https://trello.com/1/OAuthGetAccessToken';
const TRELLO_AUTHORIZE_URL = 'https://trello.com/1/OAuthAuthorizeToken';
const TRELLO_API_ROOT = 'https://api.trello.com/1';

const WORKER_INTERVAL_MS = 60_000;
const MAX_JOBS_PER_TICK = 5;

type TrelloOAuthStateRow = {
  state: string;
  user_email: string;
  team_id: string;
  request_token: string;
  request_token_secret: string;
  expires_at: string;
};

type TrelloConnectionRow = {
  id: string;
  user_email: string;
  team_id: string;
  access_token: string | null;
  token_secret: string | null;
  trello_member_id: string | null;
  trello_member_name: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  retry_count: number;
  next_sync_at: string | null;
};

type TrelloSyncJobRow = {
  id: string;
  connection_id: string;
  job_type: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
};

type TrelloBoard = {
  id: string;
  name: string;
  closed?: boolean;
  prefs?: { permissionLevel?: string };
  lists?: TrelloList[];
  cards?: TrelloCard[];
  members?: TrelloMember[];
  labels?: TrelloLabel[];
};

type TrelloList = {
  id: string;
  name: string;
  closed?: boolean;
};

type TrelloCard = {
  id: string;
  name: string;
  desc?: string;
  due?: string | null;
  idList: string;
  idMembers?: string[];
  labels?: TrelloLabel[];
  closed?: boolean;
  dateLastActivity?: string;
};

type TrelloMember = {
  id: string;
  fullName?: string;
  username?: string;
  emailAddress?: string;
  initials?: string;
  avatarUrl?: string;
};

type TrelloLabel = {
  id: string;
  name: string;
  color?: string;
};

type TrelloUserRow = {
  id: number | string;
  username: string;
  email: string;
};

export type TrelloIntegrationStatus = {
  connections: Array<TrelloConnectionRow & { pendingJobs: number; failedJobs: number }>;
  jobs: TrelloSyncJobRow[];
};

function isConfigured() {
  return Boolean(TRELLO_API_KEY && TRELLO_API_SECRET);
}

function oauthEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizedUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const port = url.port && !((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))
    ? `:${url.port}`
    : '';
  return `${url.protocol}//${url.hostname}${port}${url.pathname}`;
}

function collectOAuthParams(url: string, params: Record<string, string>) {
  const fullUrl = new URL(url);
  const collected: Record<string, string> = {};

  for (const [key, value] of fullUrl.searchParams.entries()) {
    collected[key] = value;
  }

  for (const [key, value] of Object.entries(params)) {
    collected[key] = value;
  }

  return collected;
}

function buildNormalizedParamString(params: Record<string, string>) {
  return Object.entries(params)
    .map(([key, value]) => [oauthEncode(key), oauthEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function buildOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  tokenSecret = '',
) {
  const baseString = [
    method.toUpperCase(),
    oauthEncode(normalizedUrl(url)),
    oauthEncode(buildNormalizedParamString(params)),
  ].join('&');

  const signingKey = `${oauthEncode(TRELLO_API_SECRET)}&${oauthEncode(tokenSecret)}`;

  return crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');
}

function buildOAuthHeader(params: Record<string, string>) {
  return `OAuth ${Object.entries(params)
    .filter(([key]) => key.startsWith('oauth_'))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
    .join(', ')}`;
}

function randomNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function timestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

async function fetchTextWithRetry(url: string, init: RequestInit, attempts = 3): Promise<string> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Trello request failed (${response.status}): ${text || response.statusText}`);
      }

      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Trello request failed');
}

async function fetchJsonWithRetry<T>(url: string, init: RequestInit, attempts = 3): Promise<T> {
  const text = await fetchTextWithRetry(url, init, attempts);
  return JSON.parse(text) as T;
}

async function fetchTrelloJson<T>(path: string, token: string, query: Record<string, string> = {}) {
  const url = new URL(`${TRELLO_API_ROOT}/${path.replace(/^\//, '')}`);
  url.searchParams.set('key', TRELLO_API_KEY);
  url.searchParams.set('token', token);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }

  return fetchJsonWithRetry<T>(url.toString(), { method: 'GET' });
}

async function getOAuthRequestToken(callbackUrl: string) {
  const params = collectOAuthParams(TRELLO_REQUEST_TOKEN_URL, {
    oauth_callback: callbackUrl,
    oauth_consumer_key: TRELLO_API_KEY,
    oauth_nonce: randomNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp(),
    oauth_version: '1.0',
  });

  params.oauth_signature = buildOAuthSignature('POST', TRELLO_REQUEST_TOKEN_URL, params);

  const responseText = await fetchTextWithRetry(TRELLO_REQUEST_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader(params),
    },
  });

  const parsed = new URLSearchParams(responseText);
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Trello request token response was incomplete');
  }

  return {
    oauthToken,
    oauthTokenSecret,
  };
}

async function getOAuthAccessToken(requestToken: string, requestTokenSecret: string, verifier: string) {
  const params = collectOAuthParams(TRELLO_ACCESS_TOKEN_URL, {
    oauth_consumer_key: TRELLO_API_KEY,
    oauth_nonce: randomNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp(),
    oauth_token: requestToken,
    oauth_verifier: verifier,
    oauth_version: '1.0',
  });

  params.oauth_signature = buildOAuthSignature('POST', TRELLO_ACCESS_TOKEN_URL, params, requestTokenSecret);

  const responseText = await fetchTextWithRetry(TRELLO_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader(params),
    },
  });

  const parsed = new URLSearchParams(responseText);
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');
  const memberId = parsed.get('user_id');

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Trello access token response was incomplete');
  }

  return {
    oauthToken,
    oauthTokenSecret,
    memberId,
  };
}

function buildPriorityFromLabels(labels: TrelloLabel[] = []) {
  const labelText = labels.map((label) => `${label.name} ${label.color ?? ''}`.trim().toLowerCase()).join(' ');

  if (labelText.includes('urgent') || labelText.includes('critical') || labelText.includes('high')) {
    return 'urgent';
  }

  if (labelText.includes('medium') || labelText.includes('normal') || labelText.includes('review')) {
    return 'medium';
  }

  if (labelText.includes('low') || labelText.includes('minor')) {
    return 'low';
  }

  if (labels.some((label) => ['red', 'orange'].includes(label.color ?? ''))) {
    return 'urgent';
  }

  if (labels.some((label) => ['yellow', 'purple'].includes(label.color ?? ''))) {
    return 'high';
  }

  return 'medium';
}

function buildTags(labels: TrelloLabel[] = []) {
  return JSON.stringify(
    labels
      .map((label) => label.name.trim())
      .filter(Boolean),
  );
}

function mapVisibility(permissionLevel?: string) {
  if (permissionLevel === 'public') {
    return 'public';
  }

  if (permissionLevel === 'org' || permissionLevel === 'enterprise') {
    return 'team';
  }

  return 'private';
}

async function ensureUniqueColumnSlug(boardId: string, preferredSlug: string, externalId: string) {
  let slug = preferredSlug || `column-${externalId.slice(0, 6)}`;
  let suffix = 1;

  while (true) {
    const result = await db.execute({
      sql: 'SELECT id FROM board_columns WHERE board_id = ? AND slug = ? AND external_id <> ? LIMIT 1',
      args: [boardId, slug, externalId],
    });

    if (result.rows.length === 0) {
      return slug;
    }

    suffix += 1;
    slug = `${preferredSlug}-${suffix}`;
  }
}

async function upsertTrelloUser(connectionId: string, member: TrelloMember) {
  const existingByExternalId = await db.execute({
    sql: 'SELECT id, username, email FROM users WHERE external_source = ? AND external_id = ? LIMIT 1',
    args: ['trello', member.id],
  });

  const existingByEmail = member.emailAddress
    ? await db.execute({
      sql: 'SELECT id, username, email FROM users WHERE email = ? LIMIT 1',
      args: [member.emailAddress],
    })
    : null;

  const resolvedUsername = normalizeText(member.fullName) || normalizeText(member.username) || member.id;
  const emailLocalPart = normalizeText(member.username)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || member.id;
  const resolvedEmail = normalizeText(member.emailAddress) || `${emailLocalPart}@trello.local`;

  if (existingByExternalId.rows[0]) {
    const user = existingByExternalId.rows[0] as unknown as TrelloUserRow;
    await db.execute({
      sql: `
        UPDATE users SET username = ?, email = ?, picture = COALESCE(picture, NULL), external_source = 'trello', external_id = ?
        WHERE id = ?
      `,
      args: [resolvedUsername, resolvedEmail, member.id, user.id],
    });

    return {
      id: String(user.id),
      email: resolvedEmail,
      username: resolvedUsername,
    };
  }

  if (existingByEmail?.rows[0]) {
    const user = existingByEmail.rows[0] as unknown as TrelloUserRow;
    await db.execute({
      sql: 'UPDATE users SET username = ?, external_source = ?, external_id = ? WHERE id = ?',
      args: [resolvedUsername, 'trello', member.id, user.id],
    });

    return {
      id: String(user.id),
      email: resolvedEmail,
      username: resolvedUsername,
    };
  }

  const id = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO users (username, email, password, picture, is_verified, external_source, external_id)
      VALUES (?, ?, ?, NULL, 1, 'trello', ?)
    `,
    args: [resolvedUsername, resolvedEmail, crypto.randomBytes(32).toString('hex'), member.id],
  });

  const inserted = await db.execute({
    sql: 'SELECT id, username, email FROM users WHERE email = ? LIMIT 1',
    args: [resolvedEmail],
  });

  const row = inserted.rows[0] as TrelloUserRow | undefined;
  if (!row) {
    throw new Error('Failed to create Trello user mapping');
  }

  return {
    id: String(row.id),
    email: row.email,
    username: row.username,
  };
}

async function upsertMapping(params: {
  connectionId: string;
  trelloType: string;
  trelloId: string;
  nibrasType: string;
  nibrasId: string;
  parentTrelloId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const existing = await db.execute({
    sql: 'SELECT id FROM trello_entity_maps WHERE connection_id = ? AND trello_type = ? AND trello_id = ? LIMIT 1',
    args: [params.connectionId, params.trelloType, params.trelloId],
  });

  const payload = JSON.stringify(params.payload ?? {});

  if (existing.rows[0]) {
    await db.execute({
      sql: `
        UPDATE trello_entity_maps
        SET nibras_type = ?, nibras_id = ?, parent_trello_id = ?, payload = ?, updated_at = CURRENT_TIMESTAMP
        WHERE connection_id = ? AND trello_type = ? AND trello_id = ?
      `,
      args: [
        params.nibrasType,
        params.nibrasId,
        params.parentTrelloId ?? null,
        payload,
        params.connectionId,
        params.trelloType,
        params.trelloId,
      ],
    });
    return;
  }

  await db.execute({
    sql: `
      INSERT INTO trello_entity_maps
        (id, connection_id, trello_type, trello_id, nibras_type, nibras_id, parent_trello_id, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      crypto.randomUUID(),
      params.connectionId,
      params.trelloType,
      params.trelloId,
      params.nibrasType,
      params.nibrasId,
      params.parentTrelloId ?? null,
      payload,
    ],
  });
}

async function upsertBoard(connection: TrelloConnectionRow, board: TrelloBoard) {
  const existing = await db.execute({
    sql: 'SELECT id FROM boards WHERE external_source = ? AND external_id = ? LIMIT 1',
    args: ['trello', board.id],
  });

  const title = normalizeText(board.name) || 'Trello board';
  const visibility = mapVisibility(board.prefs?.permissionLevel);
  const source = 'trello';

  if (existing.rows[0]) {
    const row = existing.rows[0] as unknown as { id: string };
    await db.execute({
      sql: `
        UPDATE boards
        SET title = ?, source = ?, external_source = 'trello', external_id = ?, visibility = ?, team_id = ?, owner_email = ?, sync_status = 'synced', sync_error = NULL, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [title, source, board.id, visibility, connection.team_id, connection.user_email, row.id],
    });
    return row.id;
  }

  const boardId = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO boards
        (id, title, source, external_source, external_id, linked_project, visibility, team_id, owner_email, sync_status, last_synced_at)
      VALUES (?, ?, ?, 'trello', ?, NULL, ?, ?, ?, 'synced', CURRENT_TIMESTAMP)
    `,
    args: [boardId, title, source, board.id, visibility, connection.team_id, connection.user_email],
  });

  return boardId;
}

async function upsertColumn(boardId: string, connectionId: string, list: TrelloList, position: number) {
  const existing = await db.execute({
    sql: 'SELECT id FROM board_columns WHERE external_source = ? AND external_id = ? LIMIT 1',
    args: ['trello', list.id],
  });

  const name = normalizeText(list.name) || 'Column';
  const preferredSlug = slugifyColumnName(name);
  const slug = await ensureUniqueColumnSlug(boardId, preferredSlug, list.id);

  if (existing.rows[0]) {
    const row = existing.rows[0] as unknown as { id: string };
    await db.execute({
      sql: `
        UPDATE board_columns
        SET board_id = ?, name = ?, slug = ?, external_source = 'trello', external_id = ?, last_synced_at = CURRENT_TIMESTAMP, position = ?
        WHERE id = ?
      `,
      args: [boardId, name, slug, list.id, position, row.id],
    });

    await upsertMapping({
      connectionId,
      trelloType: 'list',
      trelloId: list.id,
      nibrasType: 'column',
      nibrasId: row.id,
      parentTrelloId: null,
      payload: { name },
    });

    return row.id;
  }

  const columnId = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO board_columns
        (id, board_id, name, slug, external_source, external_id, position, last_synced_at)
      VALUES (?, ?, ?, ?, 'trello', ?, ?, CURRENT_TIMESTAMP)
    `,
    args: [columnId, boardId, name, slug, list.id, position],
  });

  await upsertMapping({
    connectionId,
    trelloType: 'list',
    trelloId: list.id,
    nibrasType: 'column',
    nibrasId: columnId,
    parentTrelloId: null,
    payload: { name },
  });

  return columnId;
}

async function upsertTask(params: {
  connection: TrelloConnectionRow;
  boardId: string;
  columnId: string;
  listSlug: string;
  card: TrelloCard;
  membersById: Map<string, TrelloMember>;
}) {
  const existing = await db.execute({
    sql: 'SELECT id FROM tasks WHERE external_source = ? AND external_id = ? LIMIT 1',
    args: ['trello', params.card.id],
  });

  const title = normalizeText(params.card.name) || 'Untitled card';
  const labels = params.card.labels ?? [];
  const priority = buildPriorityFromLabels(labels);
  const tags = buildTags(labels);
  const assigneeMemberId = params.card.idMembers?.[0] ?? null;
  const assignee = assigneeMemberId ? params.membersById.get(assigneeMemberId) ?? null : null;
  const assigneeEmail = assignee ? (normalizeText(assignee.emailAddress) || `${assignee.username?.trim() || assignee.id}@trello.local`) : null;
  const assigneeId = assignee ? await resolveUserIdByMember(assignee) : null;
  const dueDate = params.card.due ? new Date(params.card.due).toISOString() : null;

  if (existing.rows[0]) {
    const row = existing.rows[0] as unknown as { id: string };
    await db.execute({
      sql: `
        UPDATE tasks
        SET board_id = ?, column_id = ?, title = ?, description = ?, priority = ?, status_slug = ?, due_date = ?, assignee_email = ?, assignee_id = ?, external_source = 'trello', external_id = ?, tags = ?, sync_error = NULL, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        params.boardId,
        params.columnId,
        title,
        normalizeText(params.card.desc) || null,
        priority,
        params.listSlug,
        dueDate,
        assigneeEmail,
        assigneeId,
        params.card.id,
        tags,
        row.id,
      ],
    });

    await upsertMapping({
      connectionId: params.connection.id,
      trelloType: 'card',
      trelloId: params.card.id,
      nibrasType: 'task',
      nibrasId: row.id,
      parentTrelloId: params.card.idList,
      payload: { title, labels: labels.map((label) => label.name), priority },
    });

    return row.id;
  }

  const taskId = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO tasks
        (id, board_id, column_id, title, description, priority, status_slug, due_date, complexity, assignee_email, assignee_id, external_source, external_id, tags, created_by_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'trello', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    args: [
      taskId,
      params.boardId,
      params.columnId,
      title,
      normalizeText(params.card.desc) || null,
      priority,
      params.listSlug,
      dueDate,
      assigneeEmail,
      assigneeId,
      params.card.id,
      tags,
      params.connection.user_email,
    ],
  });

  await upsertMapping({
    connectionId: params.connection.id,
    trelloType: 'card',
    trelloId: params.card.id,
    nibrasType: 'task',
    nibrasId: taskId,
    parentTrelloId: params.card.idList,
    payload: { title, labels: labels.map((label) => label.name), priority },
  });

  return taskId;
}

async function resolveUserIdByMember(member: TrelloMember) {
  const user = await upsertTrelloUser('trello', member);
  return user.id;
}

async function syncConnection(connection: TrelloConnectionRow) {
  if (!connection.access_token || !connection.token_secret) {
    throw new Error('Missing Trello credentials');
  }

  const boardSummaries = await fetchTrelloJson<Array<{ id: string; name: string; closed?: boolean; prefs?: { permissionLevel?: string } }>>('members/me/boards', connection.access_token, {
    fields: 'id,name,closed,prefs',
  });

  for (const summary of boardSummaries) {
    if (summary.closed) {
      continue;
    }

    const board = await fetchTrelloJson<TrelloBoard>(`boards/${summary.id}`, connection.access_token, {
      fields: 'name,closed,prefs',
      lists: 'open',
      cards: 'open',
      members: 'all',
      labels: 'all',
      card_fields: 'name,desc,due,idList,idMembers,labels,closed,dateLastActivity',
      list_fields: 'name,closed',
      label_fields: 'name,color',
      member_fields: 'fullName,username,emailAddress,initials,avatarUrl',
    });

    board.prefs = summary.prefs ?? board.prefs;
    const boardId = await upsertBoard(connection, board);
    const lists = board.lists ?? [];
    const cards = board.cards ?? [];
    const members = board.members ?? [];
    const membersById = new Map(members.map((member) => [member.id, member] as const));
    const columnIdsByListId = new Map<string, string>();

    for (let position = 0; position < lists.length; position += 1) {
      const list = lists[position]!;
      const columnId = await upsertColumn(boardId, connection.id, list, position);
      columnIdsByListId.set(list.id, columnId);
    }

    for (const card of cards) {
      const columnId = columnIdsByListId.get(card.idList);
      if (!columnId) {
        continue;
      }

      const list = lists.find((item) => item.id === card.idList);
      const listSlug = slugifyColumnName(list?.name ?? 'column');
      await upsertTask({
        connection,
        boardId,
        columnId,
        listSlug,
        card,
        membersById,
      });
    }

    await db.execute({
      sql: 'UPDATE boards SET sync_status = ?, sync_error = NULL, last_synced_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: ['synced', boardId],
    });

    await recalculateBoardState(boardId);
  }

  await db.execute({
    sql: `
      UPDATE trello_connections
      SET last_sync_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          retry_count = 0,
          next_sync_at = datetime('now', '+15 minutes'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [connection.id],
  });
}

async function updateConnectionFailure(connectionId: string, message: string) {
  await db.execute({
    sql: `
      UPDATE trello_connections
      SET last_error = ?,
          retry_count = retry_count + 1,
          next_sync_at = datetime('now', '+' || MIN(retry_count + 1, 5) * 5 || ' minutes'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [message, connectionId],
  });
}

async function updateJobSuccess(jobId: string) {
  await db.execute({
    sql: `UPDATE trello_sync_jobs SET status = 'completed', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [jobId],
  });
}

async function updateJobFailure(job: TrelloSyncJobRow, error: Error) {
  const shouldRetry = job.attempts < job.max_attempts;
  const nextStatus = shouldRetry ? 'retrying' : 'failed';
  const retryMinutes = Math.min(2 ** Math.max(job.attempts - 1, 0) * 5, 120);
  const nextAttemptAt = shouldRetry
    ? new Date(Date.now() + retryMinutes * 60 * 1000).toISOString()
    : job.next_attempt_at;

  await db.execute({
    sql: `
      UPDATE trello_sync_jobs
      SET status = ?,
          last_error = ?,
          next_attempt_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [
      nextStatus,
      error.message,
      nextAttemptAt,
      job.id,
    ],
  });
}

async function processJob(job: TrelloSyncJobRow) {
  const connectionResult = await db.execute({
    sql: 'SELECT * FROM trello_connections WHERE id = ? LIMIT 1',
    args: [job.connection_id],
  });

  const connection = connectionResult.rows[0] as TrelloConnectionRow | undefined;
  if (!connection || connection.status !== 'active') {
    await updateJobSuccess(job.id);
    return;
  }

  try {
    if (job.job_type === 'sync_connection') {
      await syncConnection(connection);
      await updateJobSuccess(job.id);
      return;
    }

    throw new Error(`Unsupported Trello job type: ${job.job_type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Trello sync error';
    await updateConnectionFailure(connection.id, message);
    await updateJobFailure(job, error instanceof Error ? error : new Error(message));
  }
}

async function runDueJobs() {
  if (!isConfigured()) {
    return;
  }

  const result = await db.execute({
    sql: `
      SELECT *
      FROM trello_sync_jobs
      WHERE status IN ('queued', 'retrying', 'processing')
        AND next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY created_at ASC
      LIMIT ?
    `,
    args: [MAX_JOBS_PER_TICK],
  });

  const jobs = result.rows as unknown as TrelloSyncJobRow[];
  for (const job of jobs) {
    if (job.status !== 'queued' && job.status !== 'retrying' && job.status !== 'processing') {
      continue;
    }

    await db.execute({
      sql: `
        UPDATE trello_sync_jobs
        SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [job.id],
    });

    const freshJobResult = await db.execute({
      sql: 'SELECT * FROM trello_sync_jobs WHERE id = ? LIMIT 1',
      args: [job.id],
    });
    const freshJob = freshJobResult.rows[0] as TrelloSyncJobRow | undefined;
    if (!freshJob) {
      continue;
    }

    await processJob(freshJob);
  }
}

let workerStarted = false;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startTrelloSyncWorker() {
  if (workerStarted) {
    return;
  }

  workerStarted = true;
  void runDueJobs().catch((error) => console.error('Trello sync worker bootstrap failed:', error));
  workerTimer = setInterval(() => {
    void runDueJobs().catch((error) => console.error('Trello sync worker failed:', error));
  }, WORKER_INTERVAL_MS);
}

export async function stopTrelloSyncWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  workerStarted = false;
}

export async function createTrelloConnectUrl(userEmail: string, teamId: string) {
  if (!isConfigured()) {
    throw new Error('Trello OAuth is not configured');
  }

  const state = crypto.randomUUID();
  const callbackUrl = `${BACKEND_URL}/integrations/trello/callback?state=${encodeURIComponent(state)}`;
  const requestToken = await getOAuthRequestToken(callbackUrl);
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  await db.execute({
    sql: `
      INSERT INTO trello_oauth_states
        (state, user_email, team_id, request_token, request_token_secret, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      state,
      userEmail,
      teamId,
      requestToken.oauthToken,
      requestToken.oauthTokenSecret,
      expiresAt.toISOString(),
    ],
  });

  const authorizeUrl = new URL(TRELLO_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('oauth_token', requestToken.oauthToken);
  authorizeUrl.searchParams.set('name', 'Nibras');
  authorizeUrl.searchParams.set('expiration', 'never');
  authorizeUrl.searchParams.set('scope', 'read,write,account');

  return {
    authorizationUrl: authorizeUrl.toString(),
    state,
  };
}

export async function completeTrelloOAuth(params: { oauthToken: string; verifier: string; state: string }) {
  if (!isConfigured()) {
    throw new Error('Trello OAuth is not configured');
  }

  const stateResult = await db.execute({
    sql: 'SELECT * FROM trello_oauth_states WHERE state = ? LIMIT 1',
    args: [params.state],
  });
  const stateRow = stateResult.rows[0] as TrelloOAuthStateRow | undefined;

  if (!stateRow) {
    throw new Error('Invalid Trello OAuth state');
  }

  if (new Date(stateRow.expires_at) < new Date()) {
    await db.execute({ sql: 'DELETE FROM trello_oauth_states WHERE state = ?', args: [params.state] });
    throw new Error('Trello OAuth state expired');
  }

  if (stateRow.request_token !== params.oauthToken) {
    throw new Error('Trello OAuth token mismatch');
  }

  const accessToken = await getOAuthAccessToken(
    stateRow.request_token,
    stateRow.request_token_secret,
    params.verifier,
  );

  const member = await fetchTrelloJson<TrelloMember>('members/me', accessToken.oauthToken, {
    fields: 'fullName,username,emailAddress,initials,avatarUrl',
  });

  const existing = await db.execute({
    sql: 'SELECT id FROM trello_connections WHERE user_email = ? AND team_id = ? LIMIT 1',
    args: [stateRow.user_email, stateRow.team_id],
  });

  if (existing.rows[0]) {
    const row = existing.rows[0] as unknown as { id: string };
    await db.execute({
      sql: `
        UPDATE trello_connections
        SET access_token = ?, token_secret = ?, trello_member_id = ?, trello_member_name = ?, status = 'active', last_error = NULL, next_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        accessToken.oauthToken,
        accessToken.oauthTokenSecret,
        accessToken.memberId,
        normalizeText(member.fullName) || normalizeText(member.username) || 'Trello member',
        row.id,
      ],
    });

    await db.execute({ sql: 'DELETE FROM trello_oauth_states WHERE state = ?', args: [params.state] });

    await logAuditEvent({
      action: 'trello_connected',
      actorEmail: stateRow.user_email,
      targetType: 'trello_connection',
      targetId: row.id,
      details: { teamId: stateRow.team_id, reconnected: true },
    });

    return {
      connectionId: row.id,
      teamId: stateRow.team_id,
    };
  }

  const connectionId = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO trello_connections
        (id, user_email, team_id, access_token, token_secret, trello_member_id, trello_member_name, status, next_sync_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
    `,
    args: [
      connectionId,
      stateRow.user_email,
      stateRow.team_id,
      accessToken.oauthToken,
      accessToken.oauthTokenSecret,
      accessToken.memberId,
      normalizeText(member.fullName) || normalizeText(member.username) || 'Trello member',
    ],
  });

  await db.execute({ sql: 'DELETE FROM trello_oauth_states WHERE state = ?', args: [params.state] });

  await logAuditEvent({
    action: 'trello_connected',
    actorEmail: stateRow.user_email,
    targetType: 'trello_connection',
    targetId: connectionId,
    details: { teamId: stateRow.team_id, reconnected: false },
  });

  return {
    connectionId,
    teamId: stateRow.team_id,
  };
}

export async function enqueueTrelloSync(connectionId: string) {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `
      INSERT INTO trello_sync_jobs
        (id, connection_id, job_type, payload, status, attempts, max_attempts, next_attempt_at)
      VALUES (?, ?, 'sync_connection', '{}', 'queued', 0, 5, CURRENT_TIMESTAMP)
    `,
    args: [id, connectionId],
  });

  return id;
}

export async function getTrelloStatus(userEmail: string) {
  const connectionsResult = await db.execute({
    sql: `
      SELECT *
      FROM trello_connections
      WHERE user_email = ?
      ORDER BY created_at DESC
    `,
    args: [userEmail],
  });

  const jobsResult = await db.execute({
    sql: `
      SELECT *
      FROM trello_sync_jobs
      WHERE connection_id IN (
        SELECT id FROM trello_connections WHERE user_email = ?
      )
      ORDER BY created_at DESC
      LIMIT 25
    `,
    args: [userEmail],
  });

  const connections = (connectionsResult.rows as unknown as TrelloConnectionRow[]).map((connection) => ({
    ...connection,
    pendingJobs: 0,
    failedJobs: 0,
  }));

  const jobs = jobsResult.rows as unknown as TrelloSyncJobRow[];

  for (const connection of connections) {
    connection.pendingJobs = jobs.filter((job) => job.connection_id === connection.id && (job.status === 'queued' || job.status === 'retrying' || job.status === 'processing')).length;
    connection.failedJobs = jobs.filter((job) => job.connection_id === connection.id && job.status === 'failed').length;
  }

  return { connections, jobs } satisfies TrelloIntegrationStatus;
}

export async function disconnectTrelloConnection(connectionId: string, userEmail: string) {
  await db.execute({
    sql: `
      UPDATE trello_connections
      SET status = 'disconnected', access_token = NULL, token_secret = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_email = ?
    `,
    args: [connectionId, userEmail],
  });

  await db.execute({
    sql: `DELETE FROM trello_sync_jobs WHERE connection_id = ?`,
    args: [connectionId],
  });

  await logAuditEvent({
    action: 'trello_disconnected',
    actorEmail: userEmail,
    targetType: 'trello_connection',
    targetId: connectionId,
  });
}

export async function scheduleTrelloSyncForConnection(connectionId: string, userEmail: string) {
  const connectionResult = await db.execute({
    sql: 'SELECT id FROM trello_connections WHERE id = ? AND user_email = ? AND status = ? LIMIT 1',
    args: [connectionId, userEmail, 'active'],
  });

  if (!connectionResult.rows[0]) {
    throw new Error('Trello connection not found');
  }

  return enqueueTrelloSync(connectionId);
}

export function getTrelloConnectUrl(connectionId: string) {
  const callbackUrl = `${FRONTEND_URL}/integrations/trello?connectionId=${encodeURIComponent(connectionId)}`;
  return callbackUrl;
}

export function isTrelloConfigured() {
  return isConfigured();
}
