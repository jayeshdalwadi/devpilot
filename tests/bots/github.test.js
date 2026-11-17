import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createGitHubApp } from '../../src/bots/github.js';

describe('createGitHubApp', () => {
  // Throwaway key generated for the test only; no network calls are made.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-test-'));
  const keyPath = path.join(dir, 'key.pem');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs1', format: 'pem' }));

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('uses an Octokit with pagination (the bots call octokit.paginate)', () => {
    const app = createGitHubApp({ GITHUB_APP_ID: '1', GITHUB_PRIVATE_KEY_PATH: keyPath, GITHUB_WEBHOOK_SECRET: 'test' });
    expect(typeof app.octokit.paginate).toBe('function');
  });
});
