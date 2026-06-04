import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { createAccessToken, createRefreshToken, createVerificationToken, verifyAuthToken } from '../lib/jwt';
import { sendVerificationEmail } from '../../email';

const TESTING_MODE = process.env.TESTING_MODE === 'true';

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

    if (!TESTING_MODE) {
      const pendingVerification = await db.execute({
        sql: 'SELECT id, expires_at FROM verification_tokens WHERE user_email = ? ORDER BY id DESC LIMIT 1',
        args: [email],
      });

      if (pendingVerification.rows.length > 0) {
        const pending = pendingVerification.rows[0] as unknown as { id: number; expires_at: string };
        if (new Date(pending.expires_at) > new Date()) {
          set.status = 409;
          return { message: 'A verification email has already been sent. Please check your inbox.' };
        }
        await db.execute({
          sql: 'DELETE FROM verification_tokens WHERE user_email = ?',
          args: [email],
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (TESTING_MODE) {
      await db.execute({
        sql: `INSERT INTO users (username, email, password, picture, is_verified)
              VALUES (?, ?, ?, NULL, 1)`,
        args: [username, email, hashedPassword],
      });

      const accessToken = createAccessToken({ username, email });
      const refreshToken = createRefreshToken({ email });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await db.execute({
        sql: 'INSERT INTO refresh_tokens (token, email, expires_at) VALUES (?, ?, ?)',
        args: [refreshToken, email, expiresAt.toISOString()],
      });

      return {
        message: 'Registration successful',
        accessToken,
        refreshToken,
        user: { username, email, role: null },
      };
    }

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
  })

  .get('/me', async ({ headers, set }) => {
  const payload = verifyAuthToken(headers.authorization);

  if (!payload) {
    set.status = 401;
    return { message: 'Unauthorized' };
  }

  const result = await db.execute({
    sql: 'SELECT id, username, email, is_verified, role FROM users WHERE email = ?',
    args: [payload.email],
  });

  const user = result.rows[0];

  if (!user) {
    set.status = 404;
    return { message: 'User not found' };
  }

  return {
    user,
  };
})


  .patch('/profile', async ({ headers, body, set }) => {
    const payload = verifyAuthToken(headers.authorization);

    if (!payload) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const result = await db.execute({
      sql: 'SELECT username, email, password, picture, is_verified, role FROM users WHERE email = ?',
      args: [payload.email],
    });

    const user = result.rows[0] as {
      username: string;
      email: string;
      password: string;
      picture: string | null;
      is_verified: number;
      role: string | null;
    } | undefined;

    if (!user) {
      set.status = 404;
      return { message: 'User not found' };
    }

    const { username, currentPassword, newPassword, confirmNewPassword } = body;
    const updates: string[] = [];
    const values: Array<string> = [];
    let nextUsername = user.username;

    if (typeof username === 'string') {
      const trimmedUsername = username.trim();

      if (!trimmedUsername) {
        set.status = 400;
        return { message: 'Username cannot be empty' };
      }

      nextUsername = trimmedUsername;
      updates.push('username = ?');
      values.push(trimmedUsername);
    }

    const wantsPasswordChange =
      typeof currentPassword === 'string'
      || typeof newPassword === 'string'
      || typeof confirmNewPassword === 'string';

    if (wantsPasswordChange) {
      if (!currentPassword || !newPassword || !confirmNewPassword) {
        set.status = 400;
        return { message: 'Current password, new password, and confirmation are required' };
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

      if (!isCurrentPasswordValid) {
        set.status = 401;
        return { message: 'Current password is incorrect' };
      }

      if (newPassword.length < 6) {
        set.status = 400;
        return { message: 'New password must be at least 6 characters long' };
      }

      if (newPassword !== confirmNewPassword) {
        set.status = 400;
        return { message: 'New passwords do not match' };
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      updates.push('password = ?');
      values.push(hashedPassword);
    }

    if (updates.length === 0) {
      set.status = 400;
      return { message: 'No profile changes provided' };
    }

    values.push(user.email);

    await db.execute({
      sql: `UPDATE users SET ${updates.join(', ')} WHERE email = ?`,
      args: values,
    });

    const accessToken = createAccessToken({
      username: nextUsername,
      email: user.email,
      role: user.role,
    });

    return {
      message: 'Profile updated successfully',
      accessToken,
      user: {
        username: nextUsername,
        email: user.email,
        picture: user.picture,
        is_verified: user.is_verified === 1,
      },
    };
  }, {
    body: t.Object({
      username: t.Optional(t.String()),
      currentPassword: t.Optional(t.String()),
      newPassword: t.Optional(t.String({ minLength: 6 })),
      confirmNewPassword: t.Optional(t.String()),
    }),
  });
