import http from 'node:http';
import { env } from './config/env.js';
import { log } from './lib/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';

async function main() {
  await connectDb();

  // With the in-memory database the data dies with the process, so seeding has
  // to happen in-process rather than as a separate command. A CLI flag rather
  // than an env var, because `VAR=1 cmd` is not portable to Windows shells.
  if (process.argv.includes('--seed') || process.env.SEED === '1') {
    const { seed } = await import('./scripts/seed.js');
    await seed().catch((err) => log.error('Seed failed:', err));
  }

  const app = createApp();
  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(env.port, () => {
    log.info(`API   http://localhost:${env.port}/api`);
    log.info(`Realtime ready · client origin ${env.clientOrigin}`);
  });

  // Finish in-flight requests before exiting so a deploy does not drop a
  // message that was mid-send.
  const shutdown = async (signal) => {
    log.warn(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Failed to start:', err);
  process.exit(1);
});
