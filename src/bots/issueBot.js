import { runClaude } from './claude.js';
import { PLAN_MARKER, formatIssue, latestPlan, loadPrompt } from './context.js';
import { BOT_BRANCH_PREFIX, LABELS, comment, ensureLabels, listComments, setBotLabel } from './github.js';
import { updatePrState } from './state.js';

const BUILD_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'PR title, imperative, < 70 chars' },
    summary: { type: 'string', description: 'Markdown summary of the changes' },
    verification: { type: 'string', description: 'How the change was verified' },
  },
  required: ['title', 'summary', 'verification'],
};

/** Issue Bot: proposes/revises a plan, then implements it and opens a PR after `/approve`. */
export function createIssueBot(ctx) {
  const { config, botIdentity } = ctx;

  async function loadIssue(octokit, { owner, repo, number }) {
    const { data: issue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
      owner,
      repo,
      issue_number: number,
    });
    const comments = await listComments(octokit, { owner, repo, number });
    return { issue, comments };
  }

  async function plan(job) {
    const octokit = await ctx.octokitFor(job.installationId);
    const { owner, repo } = job;
    await ensureLabels(octokit, { owner, repo });

    const { issue, comments } = await loadIssue(octokit, job);
    if (issue.state !== 'open') return;

    const revising = Boolean(latestPlan(comments, botIdentity.login));
    const text = await ctx.workspace(octokit, { owner, repo, ref: config.BASE_BRANCH }, (ws) =>
      runClaude({
        config,
        cwd: ws.dir,
        mode: 'read',
        systemPrompt: loadPrompt('plan'),
        prompt: [
          revising ? 'Revise your previous plan using the maintainer feedback.' : 'Write an implementation plan.',
          '<issue>',
          formatIssue(issue, comments, botIdentity.login),
          '</issue>',
        ].join('\n'),
      }),
    );

    await comment(
      octokit,
      job,
      [
        PLAN_MARKER,
        `## ${revising ? 'Revised plan' : 'Proposed plan'}`,
        '',
        text.trim(),
        '',
        '---',
        'Reply with feedback to revise this plan, or comment `/approve` to have it implemented and opened as a PR.',
      ].join('\n'),
    );
    await setBotLabel(octokit, job, LABELS.planProposed);
  }

  async function build(job) {
    const octokit = await ctx.octokitFor(job.installationId);
    const { owner, repo, number } = job;
    const { issue, comments } = await loadIssue(octokit, job);
    const approvedPlan = latestPlan(comments, botIdentity.login);
    if (!approvedPlan) {
      await comment(octokit, job, 'There is no plan to approve yet. Comment `/plan` to have one drafted.');
      return;
    }

    await setBotLabel(octokit, job, LABELS.inProgress);
    await comment(octokit, job, 'Plan approved. Implementing it now, and I will link the PR here.');

    const branch = `${BOT_BRANCH_PREFIX}${number}`;
    try {
      const result = await ctx.workspace(octokit, { owner, repo, ref: config.BASE_BRANCH }, async (ws) => {
        await ws.createBranch(branch);
        const out = await runClaude({
          config,
          cwd: ws.dir,
          mode: 'write',
          maxTurns: 120,
          systemPrompt: loadPrompt('build'),
          outputSchema: BUILD_RESULT_SCHEMA,
          prompt: [
            '<issue>',
            formatIssue(issue, comments, botIdentity.login),
            '</issue>',
            '<plan>',
            approvedPlan,
            '</plan>',
          ].join('\n'),
        });
        const committed = await ws.commitAll(`${out.title} (#${number})`);
        if (!committed) return null;
        // The bot owns this branch; a rebuild replaces any earlier attempt.
        await ws.push(branch, { force: true });
        return out;
      });

      if (!result) {
        await comment(octokit, job, 'I could not produce any code changes for this plan. A human needs to take a look.');
        await setBotLabel(octokit, job, LABELS.needsHuman);
        return;
      }

      const body = [
        `Closes #${number}`,
        '',
        '## Summary',
        result.summary,
        '',
        '## Verification',
        result.verification,
        '',
        '---',
        '_Opened by the Issue Bot. The Review Bot and Test Bot take it from here._',
      ].join('\n');

      const { data: existing } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        state: 'open',
        head: `${owner}:${branch}`,
      });
      let pr;
      if (existing.length) {
        ({ data: pr } = await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner,
          repo,
          pull_number: existing[0].number,
          title: result.title,
          body,
        }));
      } else {
        ({ data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          title: result.title,
          head: branch,
          base: config.BASE_BRANCH,
          body,
        }));
      }

      await updatePrState(ctx.prisma, { owner, repo, number: pr.number }, {
        issueNumber: number,
        reviewRounds: 0,
        fixRounds: 0,
        lastTestLog: null,
      });
      await comment(octokit, job, `Opened #${pr.number}. It is now waiting for review.`);
      await setBotLabel(octokit, { owner, repo, number: pr.number }, LABELS.needsReview);
    } catch (err) {
      await comment(octokit, job, `The build failed: \`${err.message}\`. A human needs to take a look.`);
      await setBotLabel(octokit, job, LABELS.needsHuman);
      // Already reported on the issue; don't let the queue retry a half-finished build.
      console.error('[issue-bot] build failed', err);
    }
  }

  return { plan, build };
}
