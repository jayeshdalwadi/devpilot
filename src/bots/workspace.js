import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { simpleGit } from 'simple-git';

/**
 * Clones `owner/repo` into a fresh temp folder, checks out `ref`, runs `fn(ws)`, then deletes the folder.
 * The installation token lives only in the temp clone's remote URL and is never logged.
 */
export async function withWorkspace({ workdir, token, owner, repo, ref, botIdentity }, fn) {
  await fs.mkdir(workdir, { recursive: true });
  const dir = await fs.mkdtemp(path.join(path.resolve(workdir), `${repo}-`));
  const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    await simpleGit().clone(remote, dir, ['--branch', ref, '--single-branch', '--no-tags']);
    const git = simpleGit(dir);
    await git.addConfig('user.name', botIdentity.login);
    await git.addConfig('user.email', `${botIdentity.login}@users.noreply.github.com`);
    return await fn(createWorkspace(dir, git));
  } catch (err) {
    // Git errors can echo the remote URL; never let the token reach logs, comments or the job table.
    const safe = new Error(redactToken(err.message));
    safe.stack = redactToken(err.stack);
    throw safe;
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

export function redactToken(text = '') {
  return String(text).replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}

function createWorkspace(dir, git) {
  return {
    dir,
    git,
    async createBranch(name) {
      await git.checkoutLocalBranch(name);
    },
    /** Stages everything and commits. Returns false when there was nothing to commit. */
    async commitAll(message) {
      await git.add(['-A']);
      const status = await git.status();
      if (status.isClean()) return false;
      await git.commit(message);
      return true;
    },
    async push(branch, { force = false } = {}) {
      await git.push('origin', `HEAD:refs/heads/${branch}`, force ? ['--force'] : []);
    },
    async diffAgainst(baseBranch) {
      await git.fetch('origin', `${baseBranch}:refs/remotes/origin/${baseBranch}`, ['--no-tags']);
      return git.diff([`origin/${baseBranch}...HEAD`]);
    },
    async headSha() {
      return (await git.revparse(['HEAD'])).trim();
    },
    run(command, args, opts) {
      return runCommand(command, args, { cwd: dir, ...opts });
    },
  };
}

/** Runs a command and resolves with `{ code, output }` (stdout+stderr interleaved); never rejects on exit code. */
export function runCommand(command, args, { cwd, env, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let output = '';
    const append = (chunk) => {
      output += chunk.toString();
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      output += `\n[timed out after ${timeoutMs / 1000}s]`;
      child.kill();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: output + String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}
