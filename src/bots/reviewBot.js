import { runClaude } from './claude.js';
import { loadPrompt, truncateHead, truncateTail } from './context.js';
import { LABELS, comment, setBotLabel } from './github.js';
import { getPrState, updatePrState } from './state.js';

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'request_changes'] },
    summary: { type: 'string', description: 'One-paragraph overall assessment (Markdown)' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          comment: { type: 'string' },
        },
        required: ['severity', 'file', 'comment'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings'],
};

export function formatReview(review, round) {
  const lines = [`## Bot review, round ${round}: ${review.verdict === 'approve' ? 'passed' : 'changes requested'}`, '', review.summary];
  if (review.findings.length) {
    lines.push('', '| Severity | Location | Finding |', '|---|---|---|');
    for (const f of review.findings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`| ${f.severity} | \`${loc}\` | ${f.comment.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
  }
  return lines.join('\n');
}

/** Treat the review as passed unless there is a blocker/major finding, whatever the verdict says. */
export function reviewPassed(review) {
  return !review.findings.some((f) => f.severity === 'blocker' || f.severity === 'major');
}

/** Review Bot: reviews bot PRs and fixes its own findings (and failing tests) until clean. */
export function createReviewBot(ctx) {
  const { config } = ctx;

  async function loadPr(octokit, { owner, repo, number }) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
    });
    return data;
  }

  /** Runs the fix prompt on the PR branch and pushes. Returns false when Claude changed nothing. */
  async function applyFix(ws, pr, problems, commitMessage) {
    await runClaude({
      config,
      cwd: ws.dir,
      mode: 'write',
      maxTurns: 100,
      systemPrompt: loadPrompt('fix'),
      prompt: [`Pull request #${pr.number}: ${pr.title}`, '<problems>', problems, '</problems>'].join('\n'),
    });
    const committed = await ws.commitAll(commitMessage);
    if (committed) await ws.push(pr.head.ref);
    return committed;
  }

  async function escalate(octokit, job, reason) {
    await comment(octokit, job, `${reason}\n\nA human needs to take over from here (label \`${LABELS.needsHuman}\`).`);
    await setBotLabel(octokit, job, LABELS.needsHuman);
  }

  async function review(job) {
    const octokit = await ctx.octokitFor(job.installationId);
    const { owner, repo } = job;
    const pr = await loadPr(octokit, job);
    if (pr.state !== 'open') return;
    const state = await getPrState(ctx.prisma, job);
    const round = state.reviewRounds + 1;

    await ctx.workspace(octokit, { owner, repo, ref: pr.head.ref }, async (ws) => {
      const diff = await ws.diffAgainst(pr.base.ref);
      const result = await runClaude({
        config,
        cwd: ws.dir,
        mode: 'read',
        systemPrompt: loadPrompt('review'),
        outputSchema: REVIEW_SCHEMA,
        prompt: [
          `Pull request #${pr.number}: ${pr.title}`,
          '<pr-description>',
          truncateHead(pr.body || '', 5000),
          '</pr-description>',
          '<diff>',
          truncateHead(diff, 120_000),
          '</diff>',
        ].join('\n'),
      });

      // GitHub does not let an App approve its own PR, so the verdict is posted as a review comment.
      await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: pr.number,
        event: 'COMMENT',
        body: formatReview(result, round),
      });

      if (reviewPassed(result)) {
        await setBotLabel(octokit, job, LABELS.reviewPassed);
        return;
      }
      if (state.reviewRounds >= config.BOT_MAX_ROUNDS) {
        await escalate(octokit, job, `The review still has open findings after ${state.reviewRounds} fix rounds.`);
        return;
      }

      const problems = result.findings
        .map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.comment}`)
        .join('\n');
      const changed = await applyFix(ws, pr, problems, `Address review feedback (round ${round})`);
      if (!changed) {
        await escalate(octokit, job, 'I could not produce a fix for the review findings.');
        return;
      }
      await updatePrState(ctx.prisma, job, { reviewRounds: round });
      // Re-applying the label triggers the next review round.
      await setBotLabel(octokit, job, LABELS.needsReview);
    });
  }

  async function fixTests(job) {
    const octokit = await ctx.octokitFor(job.installationId);
    const { owner, repo } = job;
    const pr = await loadPr(octokit, job);
    if (pr.state !== 'open') return;
    const state = await getPrState(ctx.prisma, job);

    if (state.fixRounds >= config.BOT_MAX_ROUNDS) {
      await escalate(octokit, job, `Tests are still failing after ${state.fixRounds} fix rounds.`);
      return;
    }
    if (!state.lastTestLog) {
      await escalate(octokit, job, 'Tests were marked as failed, but no failure log was recorded.');
      return;
    }

    const round = state.fixRounds + 1;
    const changed = await ctx.workspace(octokit, { owner, repo, ref: pr.head.ref }, (ws) =>
      applyFix(ws, pr, truncateTail(state.lastTestLog, 30_000), `Fix failing checks (round ${round})`),
    );
    if (!changed) {
      await escalate(octokit, job, 'I could not produce a fix for the failing checks.');
      return;
    }
    await updatePrState(ctx.prisma, job, { fixRounds: round, lastTestLog: null });
    await comment(octokit, job, `Pushed a fix for the failing checks (round ${round}). Sending it back to review.`);
    await setBotLabel(octokit, job, LABELS.needsReview);
  }

  return { review, fixTests };
}
