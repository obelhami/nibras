import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { swagger } from '@elysiajs/swagger';

import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import tokenRoutes from './routes/token';

const app = new Elysia()
  .use(swagger({ path: '/docs' }))
  .use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
  }))
  .use(jwt({ name: 'jwt', secret: process.env.JWT_SECRET ?? 'dev-secret' }))
  .get('/', () => 'Hello World')
  .get('/api/hello', () => ({ message: 'Hello from Elysia Backend' }))
  .use(authRoutes)
  .use(userRoutes)
  .use(tokenRoutes)
  .listen(3000);

console.log('Elysia server is running on http://localhost:3000');
console.log(app.routes);

export default app;
