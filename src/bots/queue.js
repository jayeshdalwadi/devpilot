import PgBoss from 'pg-boss';

export const JOBS = {
  issuePlan: 'issue-plan',
  issueBuild: 'issue-build',
  prReview: 'pr-review',
  prFix: 'pr-fix',
  prTest: 'pr-test',
};

export async function createQueue(connectionString) {
  const boss = new PgBoss({ connectionString });
  boss.on('error', (err) => console.error('[queue]', err));
  await boss.start();
  return boss;
}

/** One job at a time per queue; Claude runs are heavy and touch the same repo. */
export async function registerWorkers(boss, handlers) {
  for (const [name, handler] of Object.entries(handlers)) {
    await boss.work(name, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
      console.log(`[queue] ${name} start`, job.data);
      try {
        await handler(job.data);
        console.log(`[queue] ${name} done`);
      } catch (err) {
        console.error(`[queue] ${name} failed`, err);
        throw err;
      }
    });
  }
}

export function enqueue(boss, name, data) {
  return boss.send(name, data, {
    // At most one *waiting* job per issue/PR (duplicates collapse), but a job may be queued while
    // another for the same PR is active — stages re-label from inside a running job.
    singletonKey: `${data.owner}/${data.repo}#${data.number}`,
    useSingletonQueue: true,
    retryLimit: 1,
    expireInHours: 3,
  });
}
