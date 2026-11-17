import { truncateTail } from './context.js';
import { LABELS, comment, setBotLabel } from './github.js';
import { getPrState, updatePrState } from './state.js';

export const CHECK_NAME = 'bot-tests';
const OK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const POLL_MS = 20_000;

// PR code is untrusted: run it with basic process env only, no cloud or GitHub credentials.
const BASE_ENV = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|LANG)$/i;

export function buildTestEnv(env, testDatabaseUrl) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (BASE_ENV.test(k) && v !== undefined) out[k] = v;
  }
  return { ...out, CI: 'true', NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl };
}

export const TEST_STEPS = [
  { name: 'Install', command: 'npm', args: ['ci', '--no-audit', '--no-fund'] },
  { name: 'Reset test database', command: 'npx', args: ['prisma', 'migrate', 'reset', '--force', '--skip-seed'] },
  { name: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'Test', command: 'npm', args: ['test'] },
];

/**
 * Summarises GitHub check runs for a commit, ignoring our own.
 * @returns {'pending'|'success'|'failure'}
 */
export function summarizeChecks(checkRuns) {
  const others = checkRuns.filter((r) => r.name !== CHECK_NAME);
  if (!others.length) return 'pending';
  if (others.some((r) => r.status === 'completed' && !OK_CONCLUSIONS.has(r.conclusion))) return 'failure';
  if (others.every((r) => r.status === 'completed')) return 'success';
  return 'pending';
}

/** Test Bot: runs lint and tests on the PR, waits for GitHub CI, and merges to the base branch when everything is green. */
export function createTestBot(ctx, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const { config } = ctx;

  async function runSuite(ws) {
    const env = buildTestEnv(process.env, config.TEST_DATABASE_URL);
    const log = [];
    for (const step of TEST_STEPS) {
      const { code, output } = await ws.run(step.command, step.args, { env });
      log.push(`### ${step.name} (exit ${code})\n${output}`);
      if (code !== 0) return { ok: false, failedStep: step.name, log: log.join('\n\n') };
    }
    return { ok: true, log: log.join('\n\n') };
  }

  async function waitForCi(octokit, { owner, repo, sha }) {
    const deadline = Date.now() + config.BOT_CI_TIMEOUT_MINUTES * 60_000;
    while (Date.now() < deadline) {
      const runs = await octokit.paginate('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        owner,
        repo,
        ref: sha,
        per_page: 100,
      });
      const status = summarizeChecks(runs);
      if (status !== 'pending') return { status, runs: runs.filter((r) => r.name !== CHECK_NAME) };
      await sleep(POLL_MS);
    }
    return { status: 'timeout', runs: [] };
  }

  async function fail(octokit, job, log, headline) {
    await updatePrState(ctx.prisma, job, { lastTestLog: log });
    await comment(octokit, job, `${headline} Sending it back for a fix.`);
    await setBotLabel(octokit, job, LABELS.testsFailed);
  }

  async function test(job) {
    const octokit = await ctx.octokitFor(job.installationId);
    const { owner, repo, number } = job;
    const { data: pr } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
    });
    if (pr.state !== 'open') return;
    const sha = pr.head.sha;

    const { data: check } = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
      owner,
      repo,
      name: CHECK_NAME,
      head_sha: sha,
      status: 'in_progress',
    });

    const suite = await ctx.workspace(octokit, { owner, repo, ref: pr.head.ref }, async (ws) => {
      // The branch may have moved since the label was applied; test exactly what will be merged.
      if ((await ws.headSha()) !== sha) return { ok: false, stale: true, log: '' };
      return runSuite(ws);
    });

    if (suite.stale) {
      await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
        owner,
        repo,
        check_run_id: check.id,
        status: 'completed',
        conclusion: 'cancelled',
        output: { title: 'Branch changed during the test run', summary: 'A newer commit will be tested.' },
      });
      return;
    }

    await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
      owner,
      repo,
      check_run_id: check.id,
      status: 'completed',
      conclusion: suite.ok ? 'success' : 'failure',
      output: {
        title: suite.ok ? 'Lint and tests passed' : `${suite.failedStep} failed`,
        summary: suite.ok ? 'All steps passed.' : `The **${suite.failedStep}** step failed. See the log below.`,
        text: '```\n' + truncateTail(suite.log, 60_000) + '\n```',
      },
    });

    if (!suite.ok) {
      await fail(octokit, job, suite.log, `Local checks failed at **${suite.failedStep}**.`);
      return;
    }

    const ci = await waitForCi(octokit, { owner, repo, sha });
    if (ci.status === 'timeout') {
      await comment(
        octokit,
        job,
        `Local tests passed, but GitHub CI did not finish within ${config.BOT_CI_TIMEOUT_MINUTES} minutes. Re-add \`${LABELS.reviewPassed}\` to retry.`,
      );
      await setBotLabel(octokit, job, LABELS.needsHuman);
      return;
    }
    if (ci.status === 'failure') {
      const failed = ci.runs.filter((r) => r.status === 'completed' && !OK_CONCLUSIONS.has(r.conclusion));
      const log = failed
        .map((r) => `CI check "${r.name}" concluded ${r.conclusion}: ${r.output?.title || ''}\n${r.output?.summary || ''}\n${r.details_url}`)
        .join('\n\n');
      await fail(octokit, job, log, `GitHub CI failed: ${failed.map((r) => `\`${r.name}\``).join(', ')}.`);
      return;
    }

    await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
      owner,
      repo,
      pull_number: number,
      merge_method: 'squash',
      sha,
    });
    await setBotLabel(octokit, job, LABELS.merged);
    await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { owner, repo, ref: `heads/${pr.head.ref}` }).catch(() => {});

    const state = await getPrState(ctx.prisma, job);
    await comment(octokit, job, `All checks passed. Merged into \`${pr.base.ref}\`.`);
    if (state.issueNumber) {
      await setBotLabel(octokit, { owner, repo, number: state.issueNumber }, LABELS.merged);
    }
  }

  return { test };
}
