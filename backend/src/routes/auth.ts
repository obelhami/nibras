import { Elysia, t } from 'elysia';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { verifyAuthToken } from '../lib/jwt';
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
      const googleUser = (await res.json()) as {
        id: string;
        email: string;
        name: string;
        picture: string;
      };

      const token = jsonwebtoken.sign({
        sub: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
      }, JWT_SECRET);

      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/auth/callback?token=${token}`;
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

    const googlePayload = jsonwebtoken.verify(token, JWT_SECRET);
    if (typeof googlePayload === 'object' && googlePayload) {
      return {
        id: String(googlePayload.sub ?? ''),
        email: String(googlePayload.email ?? ''),
        name: typeof googlePayload.name === 'string' ? googlePayload.name : null,
        picture: typeof googlePayload.picture === 'string' ? googlePayload.picture : null,
      };
    }

    const localPayload = verifyAuthToken(auth);
    if (localPayload) {
      return {
        id: localPayload.email,
        email: localPayload.email,
        name: localPayload.username,
        picture: null,
      };
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

    const email = payload.email;
    const username = payload.username ?? email.split('@')[0];

    // generate token and expiry
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await db.execute({
      sql: 'INSERT INTO verification_tokens (token, user_email, expires_at) VALUES (?, ?, ?)',
      args: [verificationToken, email, expiresAt.toISOString()],
    });

    await sendVerificationEmail(email, verificationToken, username);

    return { message: 'Verification email sent' };
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
      sql: 'SELECT * FROM verification_tokens WHERE token = ?',
      args: [token],
    });

    const row = result.rows[0] as { id: number; token: string; user_email: string; expires_at: string } | undefined;

    if (!row) {
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/?error=invalid_token`;
      return;
    }

    if (new Date(row.expires_at) < new Date()) {
      // delete expired token
      await db.execute({ sql: 'DELETE FROM verification_tokens WHERE token = ?', args: [token] });
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/?error=token_expired`;
      return;
    }

    // mark user verified
    await db.execute({ sql: 'UPDATE users SET is_verified = 1 WHERE email = ?', args: [row.user_email] });
    // remove token
    await db.execute({ sql: 'DELETE FROM verification_tokens WHERE token = ?', args: [token] });

    set.status = 302;
    set.headers['location'] = `${FRONTEND_URL}/?verified=true`;
  })
