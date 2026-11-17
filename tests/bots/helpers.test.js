import { describe, expect, it } from 'vitest';
import { buildClaudeEnv } from '../../src/bots/claude.js';
import { PLAN_MARKER, formatIssue, latestPlan, truncateTail } from '../../src/bots/context.js';
import { formatReview, reviewPassed } from '../../src/bots/reviewBot.js';
import { CHECK_NAME, buildTestEnv, summarizeChecks } from '../../src/bots/testBot.js';
import { redactToken } from '../../src/bots/workspace.js';
import { loadConfig } from '../../src/config.js';

const botLogin = 'base-bot[bot]';

describe('environment filtering', () => {
  const env = {
    PATH: '/usr/bin',
    GITHUB_WEBHOOK_SECRET: 'w',
    GITHUB_PRIVATE_KEY_PATH: 'k.pem',
    DATABASE_URL: 'postgres://prod',
    AWS_REGION: 'us-east-1',
    CLAUDE_CODE_USE_BEDROCK: '1',
  };

  it('gives Claude provider settings but no GitHub secrets or main DB', () => {
    const out = buildClaudeEnv(env, 'postgres://test');
    expect(out).toMatchObject({ PATH: '/usr/bin', AWS_REGION: 'us-east-1', CLAUDE_CODE_USE_BEDROCK: '1', DATABASE_URL: 'postgres://test' });
    expect(out).not.toHaveProperty('GITHUB_WEBHOOK_SECRET');
    expect(out).not.toHaveProperty('GITHUB_PRIVATE_KEY_PATH');
  });

  it('runs PR code without any cloud or GitHub credentials', () => {
    const out = buildTestEnv(env, 'postgres://test');
    expect(out).toEqual({ PATH: '/usr/bin', CI: 'true', NODE_ENV: 'test', DATABASE_URL: 'postgres://test' });
  });

  it('redacts installation tokens from git errors', () => {
    expect(redactToken("fatal: unable to access 'https://x-access-token:ghs_abc123@github.com/a/b.git/'")).toBe(
      "fatal: unable to access 'https://x-access-token:***@github.com/a/b.git/'",
    );
  });
});

describe('issue context', () => {
  const issue = { number: 5, title: 'Add search', body: 'Please add search', user: { login: 'alice' } };
  const comments = [
    { user: { login: botLogin }, body: `${PLAN_MARKER}\nplan v1`, created_at: 't1' },
    { user: { login: 'alice' }, body: 'use ILIKE', created_at: 't2' },
    { user: { login: botLogin }, body: 'Plan approved, implementing', created_at: 't3' },
    { user: { login: botLogin }, body: `${PLAN_MARKER}\nplan v2`, created_at: 't4' },
  ];

  it('picks the most recent plan', () => {
    expect(latestPlan(comments, botLogin)).toBe('plan v2');
    expect(latestPlan([], botLogin)).toBeNull();
  });

  it('includes feedback and previous plans, but not bot status chatter', () => {
    const text = formatIssue(issue, comments, botLogin);
    expect(text).toContain('Please add search');
    expect(text).toContain('Comment by @alice');
    expect(text).toContain('plan v1');
    expect(text).not.toContain('implementing');
    expect(text).not.toContain(PLAN_MARKER);
  });

  it('truncates long logs from the front', () => {
    expect(truncateTail('abcdef', 3)).toMatch(/truncated[\s\S]*def$/);
    expect(truncateTail('abc', 10)).toBe('abc');
  });
});

describe('review decisions', () => {
  it('passes with only minor findings', () => {
    expect(reviewPassed({ findings: [{ severity: 'minor' }] })).toBe(true);
    expect(reviewPassed({ findings: [{ severity: 'major' }] })).toBe(false);
  });

  it('renders findings as a table and escapes pipes', () => {
    const md = formatReview(
      { verdict: 'request_changes', summary: 'Needs work', findings: [{ severity: 'major', file: 'src/a.js', line: 3, comment: 'a | b' }] },
      2,
    );
    expect(md).toContain('round 2: changes requested');
    expect(md).toContain('`src/a.js:3`');
    expect(md).toContain('a \\| b');
  });
});

describe('summarizeChecks', () => {
  const run = (name, status, conclusion = null) => ({ name, status, conclusion });

  it('waits until another check exists and has finished', () => {
    expect(summarizeChecks([])).toBe('pending');
    expect(summarizeChecks([run(CHECK_NAME, 'completed', 'success')])).toBe('pending');
    expect(summarizeChecks([run('test', 'in_progress')])).toBe('pending');
  });

  it('succeeds when every CI check is green and fails fast on any red one', () => {
    expect(summarizeChecks([run('test', 'completed', 'success'), run('x', 'completed', 'skipped')])).toBe('success');
    expect(summarizeChecks([run('test', 'completed', 'failure'), run('x', 'in_progress')])).toBe('failure');
  });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(config).toMatchObject({ PORT: 3000, BASE_BRANCH: 'master', BOTS_ENABLED: false, BOT_MAX_ROUNDS: 3 });
  });

  it('requires GitHub App settings when bots are enabled', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', BOTS_ENABLED: 'true' })).toThrow(/GITHUB_APP_ID/);
  });
});
