import type pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadEnvFile } from './load-env.js';
import { createLogger } from './logger.js';

// Host development reads backend/.env; containers have no such file and get
// their configuration from compose `environment:` instead (no-op there).
loadEnvFile();
const config = loadConfig();
const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, version: config.version }, 'backend listening');
});

/**
 * Graceful shutdown: Docker sends SIGTERM (then SIGKILL after the compose
 * stop_grace_period). We stop accepting new connections, drain in-flight
 * requests, close the pool, and exit — otherwise the LB sees a hard cut and
 * in-flight writes can be lost mid-request.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((closeErr) => {
    if (closeErr) logger.error({ err: closeErr }, 'error while closing http server');
    void (app.locals.pool as pg.Pool | undefined)
      ?.end()
      .catch((err: unknown) => logger.error({ err }, 'error closing db pool'))
      .finally(() => {
        clearTimeout(forceExit);
        logger.info('shutdown complete');
        process.exit(0);
      });
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
