import { createBotContext } from './context.js';
import { createGitHubApp } from './github.js';
import { createIssueBot } from './issueBot.js';
import { JOBS, createQueue, registerWorkers } from './queue.js';
import { createReviewBot } from './reviewBot.js';
import { createTestBot } from './testBot.js';
import { createWebhookMiddleware } from './webhook.js';

/** Wires the GitHub App, job queue and the three bots. Returns the webhook middleware for Express. */
export async function startBots({ config, prisma }) {
  const app = createGitHubApp(config);
  const ctx = await createBotContext({ app, config, prisma });
  const boss = await createQueue(config.DATABASE_URL);

  const issueBot = createIssueBot(ctx);
  const reviewBot = createReviewBot(ctx);
  const testBot = createTestBot(ctx);

  await registerWorkers(boss, {
    [JOBS.issuePlan]: issueBot.plan,
    [JOBS.issueBuild]: issueBot.build,
    [JOBS.prReview]: reviewBot.review,
    [JOBS.prFix]: reviewBot.fixTests,
    [JOBS.prTest]: testBot.test,
  });

  const middleware = createWebhookMiddleware({ app, boss, botIdentity: ctx.botIdentity });
  console.log(`[bots] running as ${ctx.botIdentity.login}`);
  return { middleware, stop: () => boss.stop({ graceful: true }) };
}
