import type { Express } from 'express';
import type pg from 'pg';
import { testDatabaseUrl } from './test-db-url.js';

// ---------------------------------------------------------------------------
// Ordering matters! `src/config.ts` reads process.env when it is first
// imported. Vitest hoists static imports, so the ONLY safe way to point the
// app under test at the *_test database is: mutate env at module load, then
// import the app DYNAMICALLY inside the helpers below. Every integration test
// file must reach the app through createTestApp() — never import ../src/…
// statically at the top of a test file.
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.CORS_ORIGINS = '';
process.env.TRUST_PROXY = '0';

export async function createTestApp(): Promise<Express> {
  const [{ createApp }, { loadConfig }, { createLogger }] = await Promise.all([
    import('../src/app.js'),
    import('../src/config.js'),
    import('../src/logger.js'),
  ]);
  const config = loadConfig();
  return createApp({ config, logger: createLogger({ logLevel: 'silent', logFormat: 'json' }) });
}

export async function resetTasks(app: Express): Promise<void> {
  const pool = app.locals.pool as pg.Pool;
  await pool.query('DELETE FROM tasks');
}

export async function closeApp(app: Express): Promise<void> {
  const pool = app.locals.pool as pg.Pool;
  await pool.end();
}
