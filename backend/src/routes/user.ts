import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { createAccessToken, createRefreshToken, createVerificationToken, verifyAuthToken } from '../lib/jwt';
import { sendVerificationEmail } from '../../email';

export default new Elysia()
  .get('/profile', ({ headers, set }) => {
    const payload = verifyAuthToken(headers.authorization);

    if (!payload) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    return {
      message: 'JWT verified successfully',
      user: {
        username: payload.username,
        email: payload.email,
      },
    };
  })

  .post('/register', async ({ body, set }) => {
    const { username, email, password, confirmPassword } = body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      set.status = 400;
      return { message: 'Invalid email format' };
    }

    if (password !== confirmPassword) {
      set.status = 400;
      return { message: 'Passwords do not match' };
    }

    const existingUser = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    });

    if (existingUser.rows.length > 0) {
      set.status = 409;
      return { message: 'Email already registered' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.execute({
      sql: 'DELETE FROM verification_tokens WHERE user_email = ?',
      args: [email],
    });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await db.execute({
      sql: 'INSERT INTO verification_tokens (token, user_email, payload, expires_at) VALUES (?, ?, ?, ?)',
      args: [
        verificationToken,
        email,
        JSON.stringify({ username, passwordHash: hashedPassword }),
        expiresAt.toISOString(),
      ],
    });

    const accessToken = createVerificationToken({ username, email });

    try {
      await sendVerificationEmail(email, verificationToken, username);
    } catch (error) {
      set.status = 502;
      return {
        message: error instanceof Error ? error.message : 'Failed to send verification email',
      };
    }

    return {
      message: 'Registration successful',
      accessToken,
    };
  }, {
    body: t.Object({
      username: t.String(),
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 6 }),
      confirmPassword: t.String(),
    }),
  })

  .post('/user/role', async ({ body, headers, set }) => {
    const payload = verifyAuthToken(headers.authorization);

    if (!payload) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const { role } = body;
    const validRoles = ['admin', 'manager', 'developer'];

    if (!validRoles.includes(role)) {
      set.status = 400;
      return { message: 'Invalid role. Must be one of: admin, manager, developer' };
    }

    const result = await db.execute({
      sql: 'SELECT id, role FROM users WHERE email = ?',
      args: [payload.email],
    });

    const user = result.rows[0] as { id: number; role: string | null } | undefined;

    if (!user) {
      set.status = 404;
      return { message: 'User not found' };
    }

    if (user.role) {
      set.status = 409;
      return { message: 'Role already assigned' };
    }

    await db.execute({
      sql: 'UPDATE users SET role = ? WHERE email = ?',
      args: [role, payload.email],
    });

    const accessToken = createAccessToken({ username: payload.username, email: payload.email, role });
    const refreshToken = createRefreshToken({ email: payload.email });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.execute({
      sql: 'INSERT INTO refresh_tokens (token, email, expires_at) VALUES (?, ?, ?)',
      args: [refreshToken, payload.email, expiresAt.toISOString()],
    });

    return {
      message: 'Role assigned successfully',
      role,
      accessToken,
      refreshToken,
    };
  }, {
    body: t.Object({
      role: t.String(),
    }),
  })

  .post('/login', async ({ body, set }) => {
    const { email, password } = body;

    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email],
    });

    const user = result.rows[0] as {
      username: string;
      email: string;
      password: string;
      is_verified?: number;
      role?: string | null;
    } | undefined;

    if (!user) {
      set.status = 404;
      return { message: 'User not found' };
    }

    if (user.is_verified !== 1) {
      set.status = 403;
      return { message: 'Please verify your email first' };
    }

    const isMatch = await bcrypt.compare(password, user.password as string);

    if (!isMatch) {
      set.status = 401;
      return { message: 'Wrong password' };
    }

    const accessToken = createAccessToken({ username: user.username, email: user.email, role: user.role });
    const refreshToken = createRefreshToken(user);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.execute({
      sql: 'INSERT INTO refresh_tokens (token, email, expires_at) VALUES (?, ?, ?)',
      args: [refreshToken, user.email, expiresAt.toISOString()],
    });

    return {
      message: 'Login successful',
      user: { username: user.username, email: user.email, role: user.role ?? null },
      accessToken,
      refreshToken,
    };
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String(),
    }),
  })

  .post('/logout', async ({ body, set }) => {
    const { refreshToken } = body;

    // delete from database so it can never be used again
    await db.execute({
      sql: 'DELETE FROM refresh_tokens WHERE token = ?',
      args: [refreshToken],
    });

    return { message: 'Logged out successfully' };
  }, {
    body: t.Object({ refreshToken: t.String() }),
  });
