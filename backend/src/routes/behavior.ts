import { Elysia, t } from 'elysia';
import {
  analyzeContributionStyle,
  detectReviewSaturation,
  detectSilentOverload,
} from '../lib/behavior';

export default new Elysia()
  .post('/behavior/silent-overload', async ({ body }) => {
    return detectSilentOverload(body.userId);
  }, {
    body: t.Object({
      userId: t.String(),
    }),
  })
  .post('/behavior/review-saturation', async ({ body }) => {
    return detectReviewSaturation(body.projectId);
  }, {
    body: t.Object({
      projectId: t.String(),
    }),
  })
  .post('/behavior/contribution-style', async ({ body }) => {
    return analyzeContributionStyle(body.userId);
  }, {
    body: t.Object({
      userId: t.String(),
    }),
  });