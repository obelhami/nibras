import { Elysia, t } from 'elysia';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { createAccessToken, verifyAuthToken } from '../lib/jwt';
import { getPermissions } from '../lib/permissions';
import crypto from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import { db } from '../../db';
import { sendVerificationEmail } from '../../email';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const google = new Google(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BACKEND_URL}/auth/google/callback`
);

const stateStore = new Map<string, string>();

export default new Elysia()
  .get('/auth/google', ({ set }) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);

    stateStore.set(state, codeVerifier);
    setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

    set.status = 302;
    set.headers['location'] = url.toString();
  })

  .get('/auth/google/callback', async ({ query, set }) => {
    const { code, state } = query;

    if (!state || !stateStore.has(state)) {
      set.status = 400;
      return { error: 'Invalid state parameter' };
    }

    const codeVerifier = stateStore.get(state)!;
    stateStore.delete(state);

    try {
      const tokens = await google.validateAuthorizationCode(code!, codeVerifier);
      const accessToken = tokens.accessToken();

      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Google userinfo request failed with status ${res.status}`);
      }

      const googleUser = (await res.json()) as {
        id: string;
        email: string;
        name: string;
        picture: string;
      };

      await db.execute({
        sql: `
          INSERT INTO users (username, email, password, picture, is_verified)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(email) DO UPDATE SET
            username = excluded.username,
            picture = excluded.picture,
            is_verified = 1
        `,
        args: [
          googleUser.name,
          googleUser.email,
          crypto.randomBytes(32).toString('hex'),
          googleUser.picture ?? null,
        ],
      });

      const userResult = await db.execute({
        sql: 'SELECT role FROM users WHERE email = ?',
        args: [googleUser.email],
      });
      const existingUser = userResult.rows[0] as { role: string | null } | undefined;

      const token = jsonwebtoken.sign({
        sub: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        ...(existingUser?.role ? { role: existingUser.role } : {}),
      }, JWT_SECRET);

      const redirectPath = existingUser?.role ? '/dashboard' : '/choose-role';
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/auth/callback?token=${token}&redirect=${redirectPath}`;
    } catch (err) {
      console.error('Google OAuth error:', err);
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/?error=auth_failed`;
    }
  })

  .get('/auth/me', async ({ headers, set }) => {
    const auth = headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const token = auth.slice(7);

    try {
      const payload = jsonwebtoken.verify(token, JWT_SECRET) as Record<string, unknown>;
      const email = typeof payload.email === 'string' ? payload.email : '';

      if (email) {
        const result = await db.execute({
          sql: 'SELECT username, email, picture, is_verified, role FROM users WHERE email = ?',
          args: [email],
        });
        const row = result.rows[0] as {
          username: string;
          email: string;
          picture: string | null;
          is_verified: number;
          role: string | null;
        } | undefined;

        if (row) {
          return {
            id: row.email,
            email: row.email,
            name: row.username,
            picture: row.picture,
            is_verified: row.is_verified === 1,
            role: row.role,
            permissions: getPermissions(row.role),
          };
        }

        if (payload.purpose === 'verification') {
          const pendingResult = await db.execute({
            sql: 'SELECT payload FROM verification_tokens WHERE user_email = ? ORDER BY id DESC LIMIT 1',
            args: [email],
          });
          const pendingRow = pendingResult.rows[0] as { payload: string } | undefined;
          const pendingPayload = pendingRow?.payload
            ? JSON.parse(pendingRow.payload) as { username?: string; passwordHash?: string }
            : {};

          return {
            id: email,
            email,
            name: pendingPayload.username ?? (typeof payload.username === 'string' ? payload.username : email.split('@')[0]),
            picture: null,
            is_verified: false,
          };
        }

        if (typeof payload.sub === 'string') {
          return {
            id: String(payload.sub),
            email,
            name: typeof payload.name === 'string' ? payload.name : null,
            picture: typeof payload.picture === 'string' ? payload.picture : null,
            is_verified: true,
          };
        }
      }
    } catch {
      // fall through to 401 below
    }

    set.status = 401;
    return { error: 'Invalid token' };
  })

  .post('/auth/send-verification', async ({ headers, set }) => {
    const payload = verifyAuthToken(headers.authorization);

    if (!payload) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    if (payload.purpose !== 'verification') {
      set.status = 400;
      return { message: 'Verification is only available for pending signups' };
    }

    const email = payload.email;
    const pendingResult = await db.execute({
      sql: 'SELECT payload FROM verification_tokens WHERE user_email = ? ORDER BY id DESC LIMIT 1',
      args: [email],
    });
    const pendingRow = pendingResult.rows[0] as { payload: string } | undefined;

    if (!pendingRow) {
      set.status = 404;
      return { message: 'No pending verification request found' };
    }

    const pendingPayload = JSON.parse(pendingRow.payload) as { username?: string; passwordHash?: string };
    const emailFallback = email.split('@')[0] ?? 'user';
    const resolvedUsername: string = pendingPayload.username ?? payload.username ?? emailFallback;

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await db.execute({
      sql: 'DELETE FROM verification_tokens WHERE user_email = ?',
      args: [email],
    });

    await db.execute({
      sql: 'INSERT INTO verification_tokens (token, user_email, payload, expires_at) VALUES (?, ?, ?, ?)',
      args: [
        verificationToken,
        email,
        JSON.stringify({
          username: resolvedUsername,
          passwordHash: pendingPayload.passwordHash ?? null,
        }),
        expiresAt.toISOString(),
      ],
    });

    try {
      await sendVerificationEmail(email, verificationToken, resolvedUsername);
      return { message: 'Verification email sent' };
    } catch (error) {
      console.error('Send verification endpoint error:', error);
      set.status = 502;
      return {
        message: error instanceof Error
          ? error.message
          : 'Failed to send verification email',
      };
    }
  }, {
    body: t.Object({})
  })

  .get('/auth/verify', async ({ query, set }) => {
    const { token } = query as { token?: string };

    if (!token) {
      set.status = 400;
      return { error: 'Missing token' };
    }

    const result = await db.execute({
      sql: 'SELECT id, token, user_email, payload, expires_at FROM verification_tokens WHERE token = ?',
      args: [token],
    });

    const row = result.rows[0] as { id: number; token: string; user_email: string; payload: string; expires_at: string } | undefined;

    if (!row) {
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/verify-email?error=invalid_token`;
      return;
    }

    if (new Date(row.expires_at) < new Date()) {
      // delete expired token
      await db.execute({ sql: 'DELETE FROM verification_tokens WHERE token = ?', args: [token] });
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/verify-email?error=token_expired`;
      return;
    }

    let pendingPayload: { username?: string; passwordHash?: string } = {};
    if (row.payload) {
      pendingPayload = JSON.parse(row.payload) as { username?: string; passwordHash?: string };
    }

    // mark user verified
    const verifiedUsername: string = pendingPayload.username ?? (row.user_email.split('@')[0] ?? 'user');
    const verifiedPasswordHash = pendingPayload.passwordHash ?? crypto.randomBytes(32).toString('hex');

    await db.execute({
      sql: `
        INSERT INTO users (username, email, password, picture, is_verified)
        VALUES (?, ?, ?, NULL, 1)
        ON CONFLICT(email) DO UPDATE SET
          username = excluded.username,
          password = excluded.password,
          is_verified = 1
      `,
      args: [
        verifiedUsername,
        row.user_email,
        verifiedPasswordHash,
      ],
    });

    await db.execute({ sql: 'DELETE FROM verification_tokens WHERE token = ?', args: [token] });
    await db.execute({ sql: 'DELETE FROM verification_tokens WHERE user_email = ?', args: [row.user_email] });

    const accessToken = createAccessToken({ id: row.user_email, username: verifiedUsername, email: row.user_email });

    set.status = 302;
    set.headers['location'] = `${FRONTEND_URL}/auth/callback?token=${accessToken}&redirect=/choose-role`;
  })
