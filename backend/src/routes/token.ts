import { Elysia, t } from 'elysia';
import jsonwebtoken from 'jsonwebtoken';
import { db } from '../../db';
import { createAccessToken } from '../lib/jwt';

const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export default new Elysia().post('/auth/refresh', async ({ body, set }) => {
  const { refreshToken } = body;

  // check if token exists in database
  const result = await db.execute({
    sql: 'SELECT * FROM refresh_tokens WHERE token = ?',
    args: [refreshToken],
  });

  const storedToken = result.rows[0] as {
    token: string;
    email: string;
    expires_at: string;
  } | undefined;

  // not found → user already logged out or token is fake
  if (!storedToken) {
    set.status = 401;
    return { message: 'Invalid refresh token' };
  }

  // check if expired
  if (new Date(storedToken.expires_at) < new Date()) {
    await db.execute({
      sql: 'DELETE FROM refresh_tokens WHERE token = ?',
      args: [refreshToken],
    });
    set.status = 401;
    return { message: 'Refresh token expired, please login again' };
  }

  // verify the token signature
  try {
    const payload = jsonwebtoken.verify(refreshToken, jwtSecret) as {
      email: string;
    };

    // get user from database
    const userResult = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [payload.email],
    });

    const user = userResult.rows[0] as {
      username: string;
      email: string;
    } | undefined;

    if (!user) {
      set.status = 401;
      return { message: 'User not found' };
    }

    // create new access token
    const newAccessToken = createAccessToken(user);

    return {
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
    };
  } catch {
    set.status = 401;
    return { message: 'Invalid refresh token' };
  }
}, {
  body: t.Object({ refreshToken: t.String() }),
});
