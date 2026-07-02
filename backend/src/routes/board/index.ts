import { Elysia } from 'elysia';
import boardRoutes from './boards.routes';
import columnRoutes from './columns.routes';
import taskRoutes from './tasks.routes';

// Board module (Kanban): boards, columns, and tasks.
// Split across ./boards.routes, ./columns.routes, ./tasks.routes;
// shared helpers live in ./shared and metric recomputation in ./metrics.
export default new Elysia()
  .use(boardRoutes)
  .use(columnRoutes)
  .use(taskRoutes);
