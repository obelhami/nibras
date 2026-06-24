import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { swagger } from '@elysiajs/swagger';

import authRoutes from './routes/auth';
import boardRoutes from './routes/board';
import projectRoutes from './routes/project';
import teamRoutes from './routes/teams';
import taskRoutes from './routes/tasks';
import userRoutes from './routes/user';
import tokenRoutes from './routes/token';
import { runTasksMigrations } from './lib/migrations';

// Tasks API polish migrations (task_assignees, task_comments, risk_score)
runTasksMigrations().catch((err) => console.error('❌ Tasks migrations failed:', err));
import kpiRoutes from './routes/kpi';

const app = new Elysia()
  .use(swagger({ path: '/docs' }))
  .use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }))
  .use(jwt({ name: 'jwt', secret: process.env.JWT_SECRET ?? 'dev-secret' }))
  // P1 - Unique error response format : uniformise les erreurs de validation
  // Elysia/TypeBox (qui utilisent leur propre format interne) vers { message, code }.
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400;
      // Extraire le message lisible depuis l'erreur TypeBox
      let message = 'Validation error';
      try {
        const parsed = JSON.parse((error as { message?: string }).message ?? '{}');
        message = parsed.message ?? parsed.summary ?? message;
      } catch {
        message = (error as { message?: string }).message ?? message;
      }
      return { message, code: 'VALIDATION_ERROR' };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { message: 'Route not found', code: 'NOT_FOUND' };
    }
    if (code === 'INTERNAL_SERVER_ERROR') {
      set.status = 500;
      return { message: 'Internal server error', code: 'INTERNAL_ERROR' };
    }
  })
  .get('/', () => 'Hello World')
  .get('/api/hello', () => ({ message: 'Hello from Elysia Backend' }))
  .use(authRoutes)
  .use(boardRoutes)
  .use(projectRoutes)
  .use(teamRoutes)
  .use(taskRoutes)
  .use(userRoutes)
  .use(tokenRoutes)
  .use(kpiRoutes)
  .listen(3000);

console.log('Elysia server is running on http://localhost:3000');
console.log("DB URL:", process.env.TURSO_DATABASE_URL);
if (process.env.TESTING_MODE === 'true') {
  console.log('TESTING_MODE is ON — email verification is disabled');
}

export default app;