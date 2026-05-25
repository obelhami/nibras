import { Elysia} from 'elysia';
import { cors } from '@elysiajs/cors';
import { db } from './db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app  = new Elysia();
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

const createAuthToken = (user: { username: string; email: string }) =>
    jwt.sign(
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
        return jwt.verify(token, jwtSecret) as {
            email: string;
            username: string;
            iat: number;
            exp: number;
        };
    } catch {
        return null;
    }
};

app.use(cors());



app.get('/', () => {
    return 'Hello World';
});


app.get('/api/hello', () => {
    return {
        message: 'Hello from Elysia Backend'
    }
})

app.get('/profile', ({ headers, set }) => {
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
});

app.post('/register', async ({ body, set }) => {

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

    // 1. validation FIRST
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

    // 2. check if user exists in DB
    const existingUser = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [email]
    });

    if (existingUser.rows.length > 0) {
        set.status = 409;
        return { message: 'Email already registered' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // 3. save user in DB
    await db.execute({
        sql: "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
        args: [username, email, hashedPassword]
    });

    const token = createAuthToken({
        username,
        email
    });

    return {
        message: 'Registration successful',
        user: { username, email },
        token
    };
});

app.post('/login', async ({ body, set }) => {

    const { email, password } = body as {
        email: string;
        password: string;
    };

    const result = await db.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [email]
    });

    console.log(result.rows);

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
});

app.listen(3000);

console.log('Elysia server is running on http://localhost:3000');