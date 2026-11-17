import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  BOTS_ENABLED: bool,
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  BASE_BRANCH: z.string().default('master'),
  BOT_MAX_ROUNDS: z.coerce.number().int().positive().default(3),
  BOT_WORKDIR: z.string().default('./.bot-workspaces'),
  BOT_CI_TIMEOUT_MINUTES: z.coerce.number().positive().default(20),

  CLAUDE_MODEL: z.string().optional(),
  CLAUDE_MAX_BUDGET_USD: z.coerce.number().positive().optional(),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join('\n  ')}`);
  }
  const config = parsed.data;

  if (config.BOTS_ENABLED) {
    const required = ['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY_PATH', 'GITHUB_WEBHOOK_SECRET', 'TEST_DATABASE_URL'];
    const missing = required.filter((k) => !config[k]);
    if (missing.length) {
      throw new Error(`BOTS_ENABLED=true but missing: ${missing.join(', ')}`);
    }
  }
  return config;
}
