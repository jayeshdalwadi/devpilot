import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';

const config = loadConfig();

let bots;
if (config.BOTS_ENABLED) {
  // Loaded lazily so the plain API runs without the bot dependencies configured.
  const { startBots } = await import('./bots/index.js');
  bots = await startBots({ config, prisma });
}

const app = createApp({ prisma, webhookMiddleware: bots?.middleware });
const server = app.listen(config.PORT, () => {
  console.log(`Server listening on http://localhost:${config.PORT} (bots ${bots ? 'enabled' : 'disabled'})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await bots?.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
