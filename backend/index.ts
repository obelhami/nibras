import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { db } from './db';
import bcrypt from 'bcryptjs';
import jsonwebtoken from 'jsonwebtoken';
import { swagger } from "@elysiajs/swagger";
import { t } from 'elysia';
import crypto from 'crypto';
import { sendVerificationEmail } from './email';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

const google = new Google(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BACKEND_URL}/auth/google/callback`
);

const stateStore = new Map<string, string>();

// Access token - lives 15 minutes
const createAccessToken = (user: { username: string; email: string }) =>
    jsonwebtoken.sign(
        { email: user.email, username: user.username },
        jwtSecret,
        { expiresIn: '15m' }
    );

// Refresh token - lives 7 days
const createRefreshToken = (user: { email: string }) =>
    jsonwebtoken.sign(
        { email: user.email },
        jwtSecret,
        { expiresIn: '7d' }
    );

const verifyAuthToken = (authorizationHeader: string | undefined) => {
    if (!authorizationHeader?.startsWith('Bearer ')) {
        return null;
    }

    const token = authorizationHeader.slice('Bearer '.length);

    try {
        return jsonwebtoken.verify(token, jwtSecret) as {
            email: string;
            username: string;
            iat: number;
            exp: number;
        };
    } catch {
        return null;
    }
};

const app = new Elysia()
  .use(swagger({path: '/docs'}))
  .use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
  }))
  .use(jwt({ name: 'jwt', secret: process.env.JWT_SECRET ?? 'dev-secret' }))
  .get('/', () => 'Hello World')
  .get('/api/hello', () => ({ message: 'Hello from Elysia Backend' }))

  // Google OAuth
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

  .get('/auth/google/callback', async ({ query, set, jwt }) => {
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
      const googleUser: {
        id: string;
        email: string;
        name: string;
        picture: string;
      } = await res.json();

      const token = await jwt.sign({
        sub: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
      });

      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/auth/callback?token=${token}`;
    } catch (err) {
      console.error('Google OAuth error:', err);
      set.status = 302;
      set.headers['location'] = `${FRONTEND_URL}/?error=auth_failed`;
    }
  })

  .get('/auth/me', async ({ headers, jwt, set }) => {
    const auth = headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    const token = auth.slice(7);

    const googlePayload = await jwt.verify(token);
    if (googlePayload) {
      return {
        id: googlePayload.sub,
        email: googlePayload.email,
        name: googlePayload.name,
        picture: googlePayload.picture,
        is_verified: true,
      };
    }

    const localPayload = verifyAuthToken(auth);
    if (localPayload) {
      const userResult = await db.execute({
        sql: "SELECT is_verified FROM users WHERE email = ?",
        args: [localPayload.email]
      });
      const isVerified = userResult.rows[0]?.is_verified === 1;

      return {
        id: localPayload.email,
        email: localPayload.email,
        name: localPayload.username,
        picture: null,
        is_verified: isVerified,
      };
    }

    set.status = 401;
    return { error: 'Invalid token' };
  })

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
            email: payload.email
        }
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
        sql: "SELECT * FROM users WHERE email = ?",
        args: [email]
    });

    if (existingUser.rows.length > 0) {
        set.status = 409;
        return { message: 'Email already registered' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.execute({
        sql: "INSERT INTO users (username, email, password, is_verified) VALUES (?, ?, ?, 0)",
        args: [username, email, hashedPassword]
    });

    const accessToken = createAccessToken({ username, email });
    const refreshToken = createRefreshToken({ email });

    // save refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.execute({
        sql: "INSERT INTO refresh_tokens (token, email, expires_at) VALUES (?, ?, ?)",
        args: [refreshToken, email, expiresAt.toISOString()]
    });

    // send verification email
    try {
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 24);

        await db.execute({
            sql: "INSERT INTO verification_tokens (token, user_email, expires_at) VALUES (?, ?, ?)",
            args: [verificationToken, email, tokenExpiry.toISOString()]
        });

        await sendVerificationEmail(email, verificationToken, username);
    } catch (err) {
        console.error('Verification email failed (user still registered):', err);
    }

    return {
        message: 'Registration successful',
        user: { username, email, is_verified: false },
        accessToken,
        refreshToken
    };
  }, {
    body: t.Object({
        username: t.String(),
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6 }),
        confirmPassword: t.String()
    })
  })

  .post('/login', async ({ body, set }) => {
    const { email, password } = body;

    const result = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [email]
    });

    const user = result.rows[0] as {
        username: string;
        email: string;
        password: string;
        is_verified: number;
    } | undefined;

    if (!user) {
        set.status = 404;
        return { message: 'User not found' };
    }

    const isMatch = await bcrypt.compare(password, user.password as string);

    if (!isMatch) {
        set.status = 401;
        return { message: 'Wrong password' };
    }

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);

    // save refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.execute({
        sql: "INSERT INTO refresh_tokens (token, email, expires_at) VALUES (?, ?, ?)",
        args: [refreshToken, user.email, expiresAt.toISOString()]
    });

    return {
        message: 'Login successful',
        user: { username: user.username, email: user.email, is_verified: user.is_verified === 1 },
        accessToken,
        refreshToken
    };
  }, {
    body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String()
    })
  })

  // ✅ new route - get new accessToken using refreshToken
  .post('/auth/refresh', async ({ body, set }) => {
    const { refreshToken } = body;

    // check if token exists in database
    const result = await db.execute({
        sql: "SELECT * FROM refresh_tokens WHERE token = ?",
        args: [refreshToken]
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
            sql: "DELETE FROM refresh_tokens WHERE token = ?",
            args: [refreshToken]
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
            sql: "SELECT * FROM users WHERE email = ?",
            args: [payload.email]
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
            accessToken: newAccessToken
        };

    } catch {
        set.status = 401;
        return { message: 'Invalid refresh token' };
    }
  }, {
    body: t.Object({
        refreshToken: t.String()
    })
  })

  // send verification email
  .post('/auth/send-verification', async ({ headers, set }) => {
    const payload = verifyAuthToken(headers.authorization);

    if (!payload) {
        set.status = 401;
        return { message: 'Unauthorized' };
    }

    const userResult = await db.execute({
        sql: "SELECT username, is_verified FROM users WHERE email = ?",
        args: [payload.email]
    });

    const user = userResult.rows[0] as { username: string; is_verified: number } | undefined;

    if (!user) {
        set.status = 404;
        return { message: 'User not found' };
    }

    if (user.is_verified === 1) {
        return { message: 'Email already verified' };
    }

    // delete any existing tokens for this user
    await db.execute({
        sql: "DELETE FROM verification_tokens WHERE user_email = ?",
        args: [payload.email]
    });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    await db.execute({
        sql: "INSERT INTO verification_tokens (token, user_email, expires_at) VALUES (?, ?, ?)",
        args: [verificationToken, payload.email, expiresAt.toISOString()]
    });

    await sendVerificationEmail(payload.email, verificationToken, user.username);

    return { message: 'Verification email sent' };
  })

  // verify email token
  .get('/auth/verify', async ({ query, set }) => {
    const { token } = query;

    if (!token) {
        set.status = 400;
        return { error: 'Missing token' };
    }

    const result = await db.execute({
        sql: "SELECT * FROM verification_tokens WHERE token = ?",
        args: [token]
    });

    const record = result.rows[0] as {
        id: number;
        token: string;
        user_email: string;
        expires_at: string;
    } | undefined;

    if (!record) {
        set.headers['location'] = `${FRONTEND_URL}/?error=invalid_token`;
        set.status = 302;
        return;
    }

    if (new Date(record.expires_at) < new Date()) {
        await db.execute({
            sql: "DELETE FROM verification_tokens WHERE token = ?",
            args: [token]
        });
        set.headers['location'] = `${FRONTEND_URL}/?error=token_expired`;
        set.status = 302;
        return;
    }

    await db.execute({
        sql: "UPDATE users SET is_verified = 1 WHERE email = ?",
        args: [record.user_email]
    });

    await db.execute({
        sql: "DELETE FROM verification_tokens WHERE user_email = ?",
        args: [record.user_email]
    });

    set.headers['location'] = `${FRONTEND_URL}/?verified=true`;
    set.status = 302;
  })

  .post('/logout', async ({ body, set }) => {
    const { refreshToken } = body;

    // delete from database so it can never be used again
    await db.execute({
        sql: "DELETE FROM refresh_tokens WHERE token = ?",
        args: [refreshToken]
    });

    return { message: 'Logged out successfully' };
  }, {
    body: t.Object({
        refreshToken: t.String()
    })
  })

  .listen(3000);

console.log('Elysia server is running on http://localhost:3000');
console.log(app.routes);