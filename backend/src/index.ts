import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { swagger } from '@elysiajs/swagger';

import authRoutes from './routes/auth';
import boardRoutes from './routes/board';
import behaviorRoutes from './routes/behavior';
import projectRoutes from './routes/project';
import teamRoutes from './routes/teams';
import taskRoutes from './routes/tasks';
import trelloRoutes from './routes/trello';
import userRoutes from './routes/user';
import tokenRoutes from './routes/token';
import notificationRoutes from './routes/notifications';
import kpiRoutes from './routes/kpi';
import aiRoutes from './routes/ai';
import kpiGlossaryRoutes from './routes/kpi-glossary';
import auditRoutes from './routes/audit';
import almassarRoutes from './routes/almassar';
import { runTasksMigrations } from './lib/migrations';
import { startTrelloSyncWorker } from './lib/trello';

runTasksMigrations().catch((err) => console.error('❌ Tasks migrations failed:', err));

// NODE_ENV=test est défini par `bun test` — le worker n'a rien à faire dans la suite.
// (TESTING_MODE=true reste le mode dev normal : il ne doit pas couper le worker.)
if (process.env.NODE_ENV !== 'test') {
  startTrelloSyncWorker();
}

// CORS — restreint aux origines connues via FRONTEND_URL env.
// En dev sans FRONTEND_URL : accepte tout. En prod : mettre l'URL réelle.
const allowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const app = new Elysia()
  .use(swagger({ path: '/docs' }))
  .use(cors({
    origin: (request) => {
      if (!process.env.FRONTEND_URL || process.env.TESTING_MODE === 'true') return true;
      const origin = request.headers.get('origin') ?? '';
      return allowedOrigins.includes(origin);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }))
  .use(jwt({ name: 'jwt', secret: process.env.JWT_SECRET ?? 'dev-secret' }))
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400;
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

  // M08 — Health check
  .get('/health', () => ({
    status: 'ok',
    service: 'nibras-backend',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  }))

  .get('/', () => 'Hello World')
  .get('/api/hello', () => ({ message: 'Hello from Elysia Backend' }))
  .use(authRoutes)
  .use(boardRoutes)
  .use(behaviorRoutes)
  .use(projectRoutes)
  .use(teamRoutes)
  .use(taskRoutes)
  .use(trelloRoutes)
  .use(userRoutes)
  .use(tokenRoutes)
  .use(notificationRoutes)
  .use(kpiRoutes)
  .use(aiRoutes)
  .use(kpiGlossaryRoutes)
  .use(auditRoutes)
  .use(almassarRoutes)
  .listen(3000);

console.log('Elysia server is running on http://localhost:3000');
console.log('DB URL:', process.env.TURSO_DATABASE_URL);
if (process.env.TESTING_MODE === 'true') {
  console.log('TESTING_MODE is ON — email verification is disabled');
}

export default app;