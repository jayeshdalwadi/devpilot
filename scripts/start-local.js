#!/usr/bin/env node
/**
 * Local launcher: `npm run local`
 *
 *  1. checks Node version and .env
 *  2. makes sure PostgreSQL is reachable (starts docker compose if available)
 *  3. applies Prisma migrations
 *  4. starts the smee webhook tunnel when bots are enabled
 *  5. starts the server in watch mode
 *
 * Flags: --no-watch   run without file watching
 *        --skip-migrate
 */
import fs from 'node:fs';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const isWin = process.platform === 'win32';
const children = [];

const log = (msg) => console.log(`\x1b[36m[local]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[local] ${msg}\x1b[0m`);
  process.exit(1);
};

// ---------- 1. prerequisites ----------
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 18)) fail(`Node 18.18+ required, found ${process.versions.node}`);

if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env');
  log('Created .env from .env.example. Review it, then run this again.');
  process.exit(0);
}
if (!fs.existsSync('node_modules')) {
  log('Installing dependencies...');
  run('npm', ['install']);
}

const { loadConfig } = await import('../src/config.js');
let config;
try {
  config = loadConfig();
} catch (err) {
  fail(err.message);
}

if (config.BOTS_ENABLED && !fs.existsSync(config.GITHUB_PRIVATE_KEY_PATH)) {
  fail(`GitHub App private key not found at ${config.GITHUB_PRIVATE_KEY_PATH} (see docs/setup-github.md)`);
}

// ---------- 2. database ----------
const databases = [{ name: 'app database', url: config.DATABASE_URL, service: 'db' }];
if (config.BOTS_ENABLED) databases.push({ name: 'test database', url: config.TEST_DATABASE_URL, service: 'db-test' });

for (const db of databases) {
  const { host, port } = hostPort(db.url);
  if (await canConnect(host, port)) {
    log(`${db.name} reachable at ${host}:${port}`);
    continue;
  }
  if (!hasDocker()) {
    fail(
      `${db.name} is not reachable at ${host}:${port}.\n` +
        '  Start PostgreSQL (or install Docker Desktop and rerun), and check the URL in .env.',
    );
  }
  log(`${db.name} not reachable, starting docker compose service "${db.service}"...`);
  run('docker', ['compose', 'up', '-d', db.service]);
  if (!(await waitFor(host, port, 60))) fail(`${db.name} did not come up on ${host}:${port} within 60s`);
  // The port opens slightly before Postgres accepts logins.
  await sleep(2000);
  log(`${db.name} is up`);
}

// ---------- 3. migrations ----------
if (!args.has('--skip-migrate')) {
  log('Applying migrations...');
  run('npx', ['prisma', 'migrate', 'deploy']);
}

// ---------- 4. webhook tunnel ----------
if (config.BOTS_ENABLED) {
  const smeeUrl = process.env.SMEE_URL;
  if (smeeUrl) {
    const target = `http://localhost:${config.PORT}/webhooks/github`;
    log(`Forwarding webhooks ${smeeUrl} -> ${target}`);
    start('smee', 'npx', ['smee', '-u', smeeUrl, '-t', target]);
  } else {
    log('SMEE_URL is empty: no webhook tunnel started (fine if GitHub can reach this server directly).');
  }
} else {
  log('Bots disabled (BOTS_ENABLED=false), so only the API will run.');
}

// ---------- 5. server ----------
const serverArgs = args.has('--no-watch') ? ['src/server.js'] : ['--watch', 'src/server.js'];
start('server', process.execPath, serverArgs, { exitWithChild: true });
log(`Starting server on http://localhost:${config.PORT}. Press Ctrl+C to stop.`);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- helpers ----------
function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin });
  if (res.status !== 0) fail(`"${cmd} ${cmdArgs.join(' ')}" failed (exit ${res.status})`);
}

function start(name, cmd, cmdArgs, { exitWithChild = false } = {}) {
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: isWin && cmd !== process.execPath });
  children.push(child);
  child.on('exit', (code) => {
    if (exitWithChild) {
      log(`${name} exited (code ${code})`);
      shutdown(code ?? 0);
    } else if (code) {
      log(`${name} exited with code ${code}`);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(typeof code === 'number' ? code : 0);
}

function hostPort(url) {
  const u = new URL(url);
  return { host: u.hostname || 'localhost', port: Number(u.port) || 5432 };
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function waitFor(host, port, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await canConnect(host, port)) return true;
    await sleep(1000);
  }
  return false;
}

function hasDocker() {
  return spawnSync('docker', ['compose', 'version'], { stdio: 'ignore', shell: isWin }).status === 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
