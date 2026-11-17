# baseApp

A Node.js + Express + PostgreSQL (Prisma) starter that also hosts three AI bots. Together they take a GitHub issue all the way to a merged PR:

```
Issue opened ──► Issue Bot: plan ──► feedback / revise ──► /approve ──► build ──► PR
PR ──► Review Bot: review ⇄ fix ──► Test Bot: lint + tests + CI ──► squash-merge to master
                         ▲                         │ failure
                         └──────── fix ◄───────────┘
```

## Quick start (API only)

Requirements: Node 18.18+ and PostgreSQL (local, or `docker compose up -d`).

```bash
npm run local               # or double-click start-local.cmd on Windows
```

The launcher creates `.env` from `.env.example` on the first run. It then installs dependencies, checks that PostgreSQL is reachable (starting `docker compose` if Docker is installed), applies migrations, starts the smee webhook tunnel when `BOTS_ENABLED=true`, and runs the server in watch mode on http://localhost:3000.
Flags: `--no-watch`, `--skip-migrate`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness and DB check |
| GET | `/api/items` | List items |
| GET | `/api/items/:id` | Get an item |
| POST | `/api/items` | Create `{ name, description? }` |
| PATCH | `/api/items/:id` | Update fields |
| DELETE | `/api/items/:id` | Delete |

### Items UI

Open http://localhost:3000/ (or your `PORT`) for a simple Items page. It is plain HTML/CSS/JS served from `public/`. The list is read-only, and each row has its own **Edit** and **Delete** buttons. **Add item** and **Edit** open the form in a modal dialog. The UI uses the `/api/items` endpoints above, which have no authentication, so do not expose it publicly.

```bash
npm test        # Vitest + Supertest (no DB needed; Prisma is faked)
npm run lint
```

## Bots

See [docs/setup-github.md](docs/setup-github.md) for creating the GitHub App, webhooks, branch protection, and Claude (Bedrock / Vertex / API) configuration.

| Code | Purpose |
|---|---|
| `src/bots/webhook.js`, `router.js` | Verifies webhooks, checks permissions, and maps events to jobs |
| `src/bots/queue.js` | pg-boss job queue (persisted in Postgres) |
| `src/bots/issueBot.js` | Plan, revise, and on `/approve` implement and open a PR |
| `src/bots/reviewBot.js` | Review the PR and fix its findings; fix failing tests |
| `src/bots/testBot.js` | Lint and tests, `bot-tests` check, wait for CI, merge |
| `src/bots/claude.js` | Claude Agent SDK wrapper (tool allowlist, filtered env) |
| `src/bots/prompts/*.md` | System prompts for each bot step |

## Project layout

```
src/app.js          Express app factory
src/server.js       Entry point (starts the bots when BOTS_ENABLED=true)
src/routes/         Routers (factories taking the Prisma client)
prisma/             Schema and migrations
tests/              Vitest tests
.github/workflows/  CI (lint, migrate, test against Postgres)
```
