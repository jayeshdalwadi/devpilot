# Setting up the GitHub bots

The three bots run inside this Express app and act as a **GitHub App**. Follow these steps once per repository.

## 1. Push the repository

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin master
```

## 2. Get a webhook URL (local development)

GitHub must reach your machine. Open https://smee.io/new, copy the channel URL into `.env` as `SMEE_URL`, and run:

```bash
npx smee -u <SMEE_URL> -t http://localhost:3000/webhooks/github
```

On a public server, use `https://<your-host>/webhooks/github` instead.

## 3. Create the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**

| Field | Value |
|---|---|
| Webhook URL | your smee URL (or public URL) |
| Webhook secret | a long random string. Put it in `.env` as `GITHUB_WEBHOOK_SECRET`. |
| Repository permissions | **Contents**: Read & write · **Issues**: Read & write · **Pull requests**: Read & write · **Checks**: Read & write · **Metadata**: Read |
| Subscribe to events | **Issues**, **Issue comment**, **Pull request** |
| Where can it be installed | Only on this account |

After creating it:
- Copy the **App ID** into `GITHUB_APP_ID`.
- **Generate a private key**, save the `.pem` file in the project root (it is git-ignored), and set `GITHUB_PRIVATE_KEY_PATH`.
- Click **Install App** and install it on your repository.

## 4. Protect `master`

Repository → **Settings → Branches → Add rule** for `master`:
- Require a pull request before merging. Set the required approvals to **0**, because the bot cannot approve its own PR.
- Require status checks to pass: select **test** (the CI workflow job) and **bot-tests**.

This makes GitHub refuse any merge that is not green, even if a bot misbehaves.

## 5. Configure Claude

Uncomment **one** provider block in `.env`:
- **AWS Bedrock**: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION`, plus AWS credentials (`AWS_PROFILE` or SSO). Enable the Claude models in the Bedrock console for that region.
- **Google Vertex AI**: `CLAUDE_CODE_USE_VERTEX=1`, `CLOUD_ML_REGION`, `ANTHROPIC_VERTEX_PROJECT_ID`, and `gcloud auth application-default login`.
- **Anthropic API**: `ANTHROPIC_API_KEY`.

`CLAUDE_MAX_BUDGET_USD` caps the spend of each individual bot run.

## 6. Start

```bash
docker compose up -d          # or point DATABASE_URL / TEST_DATABASE_URL at your own Postgres
npm run db:migrate
# set BOTS_ENABLED=true in .env
npm run dev
```

The log should show `[bots] running as <app-slug>[bot]`. The `bot:*` labels are created automatically the first time an issue is planned.

## Using the bots

1. **Open an issue** (as a collaborator). The Issue Bot comments a plan and labels the issue `bot:plan-proposed`.
   For issues opened by someone without write access, a collaborator comments `/plan`.
2. **Reply with feedback** to get a revised plan, or comment **`/approve`**.
3. The bot implements the plan on `bot/issue-<n>` and opens a PR labeled `bot:needs-review`.
4. The **Review Bot** posts a review. If it has major findings, it fixes them and reviews again, up to `BOT_MAX_ROUNDS` times. When the review is clean, it labels the PR `bot:review-passed`.
5. The **Test Bot** runs install, migrations, lint, and tests and publishes the `bot-tests` check. It then waits for GitHub CI and **squash-merges into `master`**. The `Closes #n` line in the PR closes the issue.
   If anything fails, the PR gets `bot:tests-failed`. The Review Bot fixes it and the PR goes through review again.
6. Whenever a cap is reached or something unexpected happens, the issue or PR gets **`bot:needs-human`** and the bots stop.

You can drive any step by hand by adding the matching label to a `bot/issue-*` PR, for example re-adding `bot:review-passed` to rerun the tests.

## Security notes

- Only users with **write** access can trigger the bots. Issue text is passed to Claude as untrusted data.
- Claude runs with a tool allowlist (read and search, edit, `npm test`, lint, prisma). Network tools and `git push` are blocked. The bot code does all pushing.
- Claude and the test runs receive a filtered environment. GitHub App secrets are never passed in, and test runs get no cloud credentials. Both use `TEST_DATABASE_URL`, which must point to a throwaway database.
- Bot runs execute AI-written code on this machine. Run the bots in a VM or container if the repository is not fully trusted.
