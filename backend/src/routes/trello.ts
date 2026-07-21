import { Elysia, t } from 'elysia';
import { getCurrentUser } from './board/shared';
import { hasPermission } from '../lib/permissions';
import {
  completeTrelloOAuth,
  createTrelloConnectUrl,
  disconnectTrelloConnection,
  enqueueTrelloSync,
  getTrelloStatus,
  isTrelloConfigured,
  scheduleTrelloSyncForConnection,
} from '../lib/trello';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

function canManageTrello(role: string | null) {
  return hasPermission(role, 'create_board');
}

export default new Elysia()
  .get('/integrations/trello/status', async ({ headers, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!canManageTrello(user.role)) {
      set.status = 403;
      return { message: 'You do not have permission to manage integrations' };
    }

    const status = await getTrelloStatus(user.email);
    return {
      configured: isTrelloConfigured(),
      ...status,
    };
  })

  .post('/integrations/trello/connect', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!canManageTrello(user.role)) {
      set.status = 403;
      return { message: 'You do not have permission to manage integrations' };
    }

    if (!isTrelloConfigured()) {
      set.status = 503;
      return { message: 'Trello OAuth is not configured' };
    }

    const { authorizationUrl } = await createTrelloConnectUrl(user.email, body.teamId.trim());

    return { authorizationUrl };
  }, {
    body: t.Object({
      teamId: t.String(),
    }),
  })

  .get('/integrations/trello/callback', async ({ query, set }) => {
    const state = typeof query.state === 'string' ? query.state : '';
    const oauthToken = typeof query.oauth_token === 'string' ? query.oauth_token : '';
    const verifier = typeof query.oauth_verifier === 'string' ? query.oauth_verifier : '';

    if (!state || !oauthToken || !verifier) {
      set.status = 400;
      return { message: 'Missing Trello OAuth callback parameters' };
    }

    try {
      const result = await completeTrelloOAuth({ oauthToken, verifier, state });
      await enqueueTrelloSync(result.connectionId);
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/integrations/trello?status=connected&teamId=${encodeURIComponent(result.teamId)}`;
      return;
    } catch (error) {
      console.error('Trello OAuth callback error:', error);
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/integrations/trello?status=error`;
      return;
    }
  })

  .post('/integrations/trello/sync', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!canManageTrello(user.role)) {
      set.status = 403;
      return { message: 'You do not have permission to manage integrations' };
    }

    const jobId = await scheduleTrelloSyncForConnection(body.connectionId, user.email);
    return { message: 'Trello sync queued', jobId };
  }, {
    body: t.Object({
      connectionId: t.String(),
    }),
  })

  .post('/integrations/trello/disconnect', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);

    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (!canManageTrello(user.role)) {
      set.status = 403;
      return { message: 'You do not have permission to manage integrations' };
    }

    await disconnectTrelloConnection(body.connectionId, user.email);
    return { message: 'Trello connection disconnected' };
  }, {
    body: t.Object({
      connectionId: t.String(),
    }),
  });
