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

  // Every delivery that passed signature verification, whether or not a bot acts on it.
  app.webhooks.onAny(({ id, name, payload }) => {
    const action = payload.action ? `.${payload.action}` : '';
    const where = payload.repository ? ` on ${payload.repository.full_name}` : '';
    console.log(`[webhook] received ${name}${action}${where} (delivery ${id})`);
    if (!payload.installation && name !== 'ping') {
      console.warn(
        '[webhook] this delivery has no "installation" field, so it was not sent by the GitHub App ' +
          '(probably a repository webhook). The bots cannot act on it.',
      );
    }
  });

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

  app.webhooks.onError((err) => {
    if (/signature does not match/.test(err.message)) {
      console.error(
        '[webhook] rejected delivery (400): signature mismatch. The webhook secret in the GitHub App settings ' +
          'does not equal GITHUB_WEBHOOK_SECRET in .env (check for typos, quotes or trailing spaces, then restart).',
      );
    } else {
      console.error('[webhook]', err.message);
    }
  });

  const handler = createNodeMiddleware(app.webhooks, {
    path: WEBHOOK_PATH,
    // The onError handler above already explains failures; skip the library's raw stack dump.
    log: { debug: () => {}, info: () => {}, warn: console.warn.bind(console), error: () => {} },
  });

  return (req, res, next) => {
    if (req.method === 'POST' && req.path === WEBHOOK_PATH) {
      const missing = missingWebhookHeaders(req.headers);
      if (missing.length) {
        const hint = missing.includes('x-hub-signature-256')
          ? ' GitHub only signs deliveries when a webhook secret is set. Either the GitHub App has no secret (set one matching ' +
            'GITHUB_WEBHOOK_SECRET in .env), or this came from a repository webhook (repo Settings → Webhooks) pointing at ' +
            'the same URL: delete it, since the App delivers its own events.'
          : '';
        console.error(`[webhook] rejected delivery (400): missing header(s) ${missing.join(', ')}.${hint}`);
      }
    }
    return handler(req, res, next);
  };
}

export function missingWebhookHeaders(headers) {
  return ['x-github-event', 'x-github-delivery', 'x-hub-signature-256'].filter((h) => !headers[h]);
}
