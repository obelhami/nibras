import { Elysia, t } from 'elysia';
import {
  analyzeContributionStyle,
  detectReviewSaturation,
  detectSilentOverload,
} from '../lib/behavior';
import { getCurrentUser } from './board/shared';
import { hasPermission } from '../lib/permissions';

/**
 * Module 2 (CDC §9) — "Consult behavioral signals":
 *   Developer: own explanatory signals only
 *   Manager:   aggregated and contextualized (within scope)
 *   Admin:     yes
 *
 * These routes were previously unauthenticated. This enforces: a caller can
 * always request their own signals; requesting someone else's requires
 * manager/admin (the "aggregated and contextualized" / "yes" rows).
 */
export default new Elysia()
  .post('/behavior/silent-overload', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const isSelf = user.id === body.userId;
    if (!isSelf && !hasPermission(user.role, 'view_behavioral_signals')) {
      set.status = 403;
      return { message: 'You do not have permission to view this signal' };
    }

    return detectSilentOverload(body.userId);
  }, {
    body: t.Object({
      userId: t.String(),
    }),
  })
  .post('/behavior/review-saturation', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    // Review saturation is a project/team-wide signal, not a personal one —
    // reserved to manager/admin (developers see it aggregated on their
    // dashboard, not as a raw per-project query).
    if (!hasPermission(user.role, 'view_team_kpis')) {
      set.status = 403;
      return { message: 'You do not have permission to view this signal' };
    }

    return detectReviewSaturation(body.projectId);
  }, {
    body: t.Object({
      projectId: t.String(),
    }),
  })
  .post('/behavior/contribution-style', async ({ headers, body, set }) => {
    const user = await getCurrentUser(headers.authorization);
    if (!user) {
      set.status = 401;
      return { message: 'Unauthorized' };
    }

    const isSelf = user.id === body.userId;
    if (!isSelf && !hasPermission(user.role, 'view_behavioral_signals')) {
      set.status = 403;
      return { message: 'You do not have permission to view this signal' };
    }

    return analyzeContributionStyle(body.userId);
  }, {
    body: t.Object({
      userId: t.String(),
    }),
  });