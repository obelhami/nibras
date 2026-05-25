import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { Google, generateState, generateCodeVerifier } from 'arctic';
import { db } from './db';
import bcrypt from 'bcryptjs';
import jsonwebtoken from 'jsonwebtoken';

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

const createAuthToken = (user: { username: string; email: string }) =>
    jsonwebtoken.sign(
        {
            email: user.email,
            username: user.username
        },
        jwtSecret,
        {
            expiresIn: '1h'
        }
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
  .use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
  }))
  .use(jwt({ name: 'jwt', secret: 'nibras-dev-secret' }))
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

  // Register/Login routes
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
    const {
        username,
        email,
        password,
        confirmPassword
    } = body as {
        username: string;
        email: string;
        password: string;
        confirmPassword: string;
    };

    if (!username || !email || !password || !confirmPassword) {
        set.status = 400;
        return { message: 'All fields are required' };
    }

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
        sql: "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
        args: [username, email, hashedPassword]
    });

    const token = createAuthToken({ username, email });

    return {
        message: 'Registration successful',
        user: { username, email },
        token
    };
  })

  .post('/login', async ({ body, set }) => {
    const { email, password } = body as {
        email: string;
        password: string;
    };

    const result = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [email]
    });

    const user = result.rows[0] as {
        username: string;
        email: string;
        password: string;
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

    const token = createAuthToken(user);

    return {
        message: 'Login successful',
        user: {
            username: user.username,
            email: user.email
        },
        token
    };
  })

  .listen(3000);

console.log('Elysia server is running on http://localhost:3000');
