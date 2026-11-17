import { describe, expect, it } from 'vitest';
import { LABELS } from '../../src/bots/github.js';
import { JOBS } from '../../src/bots/queue.js';
import { parseCommand, routeEvent } from '../../src/bots/router.js';

const botLogin = 'base-bot[bot]';
const repository = { name: 'baseApp', owner: { login: 'acme' } };
const installation = { id: 7 };

function issueComment({ body, labels = [], user = { login: 'alice', type: 'User' }, pull_request } = {}) {
  return {
    action: 'created',
    installation,
    repository,
    sender: user,
    issue: { number: 5, state: 'open', labels: labels.map((name) => ({ name })), pull_request },
    comment: { body, user },
  };
}

describe('parseCommand', () => {
  it('reads slash commands from the start of a comment', () => {
    expect(parseCommand('/approve')).toBe('approve');
    expect(parseCommand('  /APPROVE looks good')).toBe('approve');
    expect(parseCommand('please /approve')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });
});

describe('routeEvent', () => {
  it('plans newly opened issues', () => {
    const route = routeEvent(
      'issues.opened',
      { installation, repository, sender: { login: 'alice' }, issue: { number: 3 } },
      { botLogin },
    );
    expect(route).toEqual({
      job: JOBS.issuePlan,
      data: { installationId: 7, owner: 'acme', repo: 'baseApp', number: 3 },
      actor: 'alice',
    });
  });

  it('builds on /approve only when a plan is proposed', () => {
    expect(routeEvent('issue_comment.created', issueComment({ body: '/approve', labels: [LABELS.planProposed] }), { botLogin }).job).toBe(
      JOBS.issueBuild,
    );
    expect(routeEvent('issue_comment.created', issueComment({ body: '/approve' }), { botLogin })).toBeNull();
  });

  it('treats other comments on a proposed plan as feedback', () => {
    const route = routeEvent('issue_comment.created', issueComment({ body: 'Use a query param instead', labels: [LABELS.planProposed] }), {
      botLogin,
    });
    expect(route.job).toBe(JOBS.issuePlan);
  });

  it('plans on /plan, and ignores chatter when no plan is open', () => {
    expect(routeEvent('issue_comment.created', issueComment({ body: '/plan' }), { botLogin }).job).toBe(JOBS.issuePlan);
    expect(routeEvent('issue_comment.created', issueComment({ body: 'thanks' }), { botLogin })).toBeNull();
  });

  it('ignores its own comments, other bots and PR conversations', () => {
    const labels = [LABELS.planProposed];
    expect(routeEvent('issue_comment.created', issueComment({ body: 'x', labels, user: { login: botLogin, type: 'Bot' } }), { botLogin })).toBeNull();
    expect(routeEvent('issue_comment.created', issueComment({ body: 'x', labels, user: { login: 'dependabot[bot]', type: 'Bot' } }), { botLogin })).toBeNull();
    expect(routeEvent('issue_comment.created', issueComment({ body: '/approve', labels, pull_request: {} }), { botLogin })).toBeNull();
  });

  it.each([
    [LABELS.needsReview, JOBS.prReview],
    [LABELS.reviewPassed, JOBS.prTest],
    [LABELS.testsFailed, JOBS.prFix],
  ])('routes PR label %s to %s', (label, job) => {
    const payload = {
      action: 'labeled',
      installation,
      repository,
      sender: { login: botLogin },
      label: { name: label },
      pull_request: { number: 9, state: 'open', head: { ref: 'bot/issue-5' } },
    };
    expect(routeEvent('pull_request.labeled', payload, { botLogin })).toMatchObject({ job, data: { number: 9 } });
  });

  it('ignores labels on PRs that the bot did not open', () => {
    const payload = {
      action: 'labeled',
      installation,
      repository,
      sender: { login: 'alice' },
      label: { name: LABELS.reviewPassed },
      pull_request: { number: 9, state: 'open', head: { ref: 'feature/x' } },
    };
    expect(routeEvent('pull_request.labeled', payload, { botLogin })).toBeNull();
  });
});
