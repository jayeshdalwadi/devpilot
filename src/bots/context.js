import fs from 'node:fs';
import { getBotIdentity, getInstallationToken } from './github.js';
import { withWorkspace } from './workspace.js';

export const PLAN_MARKER = '<!-- bot:plan -->';

const promptCache = new Map();

export function loadPrompt(name) {
  if (!promptCache.has(name)) {
    const url = new URL(`./prompts/${name}.md`, import.meta.url);
    promptCache.set(name, fs.readFileSync(url, 'utf8'));
  }
  return promptCache.get(name);
}

/** Keeps the end of long text (logs, diffs), where failures usually are. */
export function truncateTail(text, max) {
  if (!text || text.length <= max) return text || '';
  return `[... ${text.length - max} characters truncated ...]\n${text.slice(-max)}`;
}

export function truncateHead(text, max) {
  if (!text || text.length <= max) return text || '';
  return `${text.slice(0, max)}\n[... ${text.length - max} characters truncated ...]`;
}

/** Renders the issue and its comments for a prompt, leaving out the bot's own plan comments. */
export function formatIssue(issue, comments, botLogin) {
  const parts = [`#${issue.number}: ${issue.title}`, `Opened by @${issue.user.login}`, '', issue.body || '(no description)'];
  for (const c of comments) {
    if (c.user.login === botLogin && c.body.includes(PLAN_MARKER)) {
      parts.push('', `--- Previous plan by the bot (${c.created_at}) ---`, c.body.replace(PLAN_MARKER, '').trim());
    } else if (c.user.login !== botLogin) {
      parts.push('', `--- Comment by @${c.user.login} (${c.created_at}) ---`, c.body);
    }
  }
  return parts.join('\n');
}

export function latestPlan(comments, botLogin) {
  const plan = [...comments].reverse().find((c) => c.user.login === botLogin && c.body.includes(PLAN_MARKER));
  return plan ? plan.body.replace(PLAN_MARKER, '').trim() : null;
}

/** Everything a bot needs at runtime; created once at startup. */
export async function createBotContext({ app, config, prisma }) {
  const botIdentity = await getBotIdentity(app);
  return {
    app,
    config,
    prisma,
    botIdentity,
    octokitFor: (installationId) => app.getInstallationOctokit(installationId),
    async workspace(octokit, { owner, repo, ref }, fn) {
      const token = await getInstallationToken(octokit);
      return withWorkspace({ workdir: config.BOT_WORKDIR, token, owner, repo, ref, botIdentity }, fn);
    },
  };
}
