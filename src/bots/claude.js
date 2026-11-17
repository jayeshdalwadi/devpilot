import { query } from '@anthropic-ai/claude-agent-sdk';

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git show:*)'];

const WRITE_TOOLS = [
  ...READ_TOOLS,
  'Edit',
  'Write',
  'Bash(npm test:*)',
  'Bash(npm run lint:*)',
  'Bash(npm install:*)',
  'Bash(npx prisma:*)',
  'Bash(npx vitest:*)',
];

// Pushing, network access and anything else stays with the bot code, not the model.
const ALWAYS_DENIED = ['WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)'];

// Variables Claude Code needs to reach the model provider, plus basic process env.
// GitHub App secrets are deliberately not passed through.
const PASSTHROUGH_ENV =
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|LANG|CLAUDE_CODE_.*|ANTHROPIC_.*|AWS_.*|CLOUD_ML_REGION|GOOGLE_.*|GCLOUD_.*|HTTPS?_PROXY|NO_PROXY)$/i;

export function buildClaudeEnv(env, testDatabaseUrl) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (PASSTHROUGH_ENV.test(k) && v !== undefined) out[k] = v;
  }
  out.NODE_ENV = 'test';
  if (testDatabaseUrl) out.DATABASE_URL = testDatabaseUrl;
  return out;
}

/**
 * Runs one headless Claude Code session inside `cwd`.
 * @param {object} p
 * @param {'read'|'write'} p.mode read = analysis only, write = may edit files and run tests
 * @param {object} [p.outputSchema] JSON schema; when given, the parsed object is returned
 */
export async function runClaude({ config, prompt, systemPrompt, cwd, mode = 'read', outputSchema, maxTurns = 60 }) {
  const options = {
    cwd,
    systemPrompt,
    allowedTools: mode === 'write' ? WRITE_TOOLS : READ_TOOLS,
    disallowedTools: ALWAYS_DENIED,
    permissionMode: 'dontAsk',
    settingSources: [],
    maxTurns,
    env: buildClaudeEnv(process.env, config.TEST_DATABASE_URL),
  };
  if (config.CLAUDE_MODEL) options.model = config.CLAUDE_MODEL;
  if (config.CLAUDE_MAX_BUDGET_USD) options.maxBudgetUsd = config.CLAUDE_MAX_BUDGET_USD;
  if (outputSchema) options.outputFormat = { type: 'json_schema', schema: outputSchema };

  let result;
  for await (const message of query({ prompt, options })) {
    if (message.type === 'result') result = message;
  }

  if (!result) throw new Error('Claude session ended without a result');
  if (result.subtype !== 'success') {
    throw new Error(`Claude session failed: ${result.subtype}`);
  }
  console.log(`[claude] ${mode} run: ${result.num_turns} turns, ~$${result.total_cost_usd?.toFixed(2)}`);

  if (outputSchema) {
    if (result.structured_output === undefined) throw new Error('Claude returned no structured output');
    return result.structured_output;
  }
  return result.result;
}
