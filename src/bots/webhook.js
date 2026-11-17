import { createNodeMiddleware } from '@octokit/webhooks';
import { hasWriteAccess } from './github.js';
import { enqueue } from './queue.js';
import { routeEvent } from './router.js';

export const WEBHOOK_PATH = '/webhooks/github';

/**
 * Verifies GitHub signatures, routes events to jobs and returns the Express middleware.
 * Handlers only enqueue, so GitHub gets its 200 response quickly.
 */
export function createWebhookMiddleware({ app, boss, botIdentity }) {
  const events = ['issues.opened', 'issue_comment.created', 'pull_request.labeled'];

  app.webhooks.on(events, async ({ name, payload, octokit }) => {
    const event = `${name}.${payload.action}`;
    const route = routeEvent(event, payload, { botLogin: botIdentity.login });
    if (!route) return;

    const { owner, repo, number } = route.data;
    if (route.actor !== botIdentity.login) {
      const allowed = await hasWriteAccess(octokit, { owner, repo, username: route.actor });
      if (!allowed) {
        console.log(`[webhook] ignoring ${event} on ${owner}/${repo}#${number} from ${route.actor} (no write access)`);
        return;
      }
    }

    console.log(`[webhook] ${event} on ${owner}/${repo}#${number} → ${route.job}`);
    await enqueue(boss, route.job, route.data);
  });

  app.webhooks.onError((err) => console.error('[webhook]', err.message));

  return createNodeMiddleware(app.webhooks, { path: WEBHOOK_PATH });
}
