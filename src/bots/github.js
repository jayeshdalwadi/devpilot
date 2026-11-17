import fs from 'node:fs';
import { App } from '@octokit/app';

export const LABELS = {
  planProposed: 'bot:plan-proposed',
  inProgress: 'bot:in-progress',
  needsReview: 'bot:needs-review',
  reviewPassed: 'bot:review-passed',
  testsFailed: 'bot:tests-failed',
  needsHuman: 'bot:needs-human',
  merged: 'bot:merged',
};

export const LABEL_COLORS = {
  [LABELS.planProposed]: 'c5def5',
  [LABELS.inProgress]: 'fbca04',
  [LABELS.needsReview]: '1d76db',
  [LABELS.reviewPassed]: '0e8a16',
  [LABELS.testsFailed]: 'b60205',
  [LABELS.needsHuman]: 'd93f0b',
  [LABELS.merged]: '5319e7',
};

export const BOT_BRANCH_PREFIX = 'bot/issue-';

export function createGitHubApp(config) {
  return new App({
    appId: config.GITHUB_APP_ID,
    privateKey: fs.readFileSync(config.GITHUB_PRIVATE_KEY_PATH, 'utf8'),
    webhooks: { secret: config.GITHUB_WEBHOOK_SECRET },
  });
}

/** Returns `{ slug, login }` for the App, e.g. login `my-bot[bot]`. */
export async function getBotIdentity(app) {
  const { data } = await app.octokit.request('GET /app');
  return { slug: data.slug, login: `${data.slug}[bot]` };
}

/** Short-lived installation token, used only for git clone/push over HTTPS. */
export async function getInstallationToken(octokit) {
  const { token } = await octokit.auth({ type: 'installation' });
  return token;
}

export async function hasWriteAccess(octokit, { owner, repo, username }) {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/collaborators/{username}/permission', {
      owner,
      repo,
      username,
    });
    return ['admin', 'maintain', 'write'].includes(data.permission);
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

export async function ensureLabels(octokit, { owner, repo }) {
  for (const [name, color] of Object.entries(LABEL_COLORS)) {
    try {
      await octokit.request('POST /repos/{owner}/{repo}/labels', { owner, repo, name, color });
    } catch (err) {
      if (err.status !== 422) throw err; // 422 = already exists
    }
  }
}

/**
 * Replaces every `bot:*` label on an issue/PR with `label` (or just clears them when null).
 * Removing then re-adding a label fires a fresh `labeled` webhook, which is how stages hand off.
 */
export async function setBotLabel(octokit, { owner, repo, number }, label) {
  const { data: current } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels', {
    owner,
    repo,
    issue_number: number,
  });
  for (const l of current) {
    if (!l.name.startsWith('bot:')) continue;
    await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
      owner,
      repo,
      issue_number: number,
      name: l.name,
    });
  }
  if (label) {
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
      owner,
      repo,
      issue_number: number,
      labels: [label],
    });
  }
}

export async function comment(octokit, { owner, repo, number }, body) {
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner,
    repo,
    issue_number: number,
    body,
  });
}

export async function listComments(octokit, { owner, repo, number }) {
  return octokit.paginate('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
}
