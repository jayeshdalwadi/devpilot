import { BOT_BRANCH_PREFIX, LABELS } from './github.js';
import { JOBS } from './queue.js';

const PR_LABEL_JOBS = {
  [LABELS.needsReview]: JOBS.prReview,
  [LABELS.reviewPassed]: JOBS.prTest,
  [LABELS.testsFailed]: JOBS.prFix,
};

function target(payload, number) {
  return {
    installationId: payload.installation?.id,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    number,
  };
}

function hasLabel(issue, name) {
  return (issue.labels || []).some((l) => (typeof l === 'string' ? l : l.name) === name);
}

/** First word of the comment when it is a slash command, e.g. "/approve" → "approve". */
export function parseCommand(body = '') {
  const match = body.trim().match(/^\/([a-z-]+)\b/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Maps a webhook event to the bot job it should start.
 * Returns `{ job, data, actor }` or null. `actor` must have write access unless it is the bot itself.
 * @param {string} event e.g. "issues.opened"
 */
export function routeEvent(event, payload, { botLogin }) {
  const actor = payload.sender?.login;

  switch (event) {
    case 'issues.opened': {
      if (payload.issue.pull_request) return null;
      return { job: JOBS.issuePlan, data: target(payload, payload.issue.number), actor };
    }

    case 'issue_comment.created': {
      const { issue, comment } = payload;
      // PR conversations are driven by labels, and the bot never reacts to its own comments.
      if (issue.pull_request || issue.state !== 'open') return null;
      if (comment.user.login === botLogin || comment.user.type === 'Bot') return null;

      const data = target(payload, issue.number);
      const command = parseCommand(comment.body);
      if (command === 'approve') {
        return hasLabel(issue, LABELS.planProposed) ? { job: JOBS.issueBuild, data, actor } : null;
      }
      if (command === 'plan') return { job: JOBS.issuePlan, data, actor };
      // Any other comment on an issue with an open plan is treated as feedback → revise the plan.
      if (hasLabel(issue, LABELS.planProposed)) return { job: JOBS.issuePlan, data, actor };
      return null;
    }

    case 'pull_request.labeled': {
      const { pull_request: pr, label } = payload;
      if (pr.state !== 'open' || !pr.head.ref.startsWith(BOT_BRANCH_PREFIX)) return null;
      const job = PR_LABEL_JOBS[label?.name];
      return job ? { job, data: target(payload, pr.number), actor } : null;
    }

    default:
      return null;
  }
}
