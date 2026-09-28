import { runMigrations } from '../src/db/migrate.js';
import { ensureDatabaseExists, isDbReachable, testDatabaseUrl } from './test-db-url.js';

/**
 * Runs once per `vitest` invocation, in the main process:
 *  1. point at the dedicated *_test database (created on first run),
 *  2. apply all migrations so the schema matches the code under test.
 *
 * If PostgreSQL is unreachable we WARN and continue — unit tests still run,
 * and DB-backed suites skip themselves via `describe.runIf(...)`. CI always
 * has a healthy service container, so nothing is skipped there.
 */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();

  if (!(await isDbReachable(url))) {
    console.warn(
      `\n[vitest] PostgreSQL unreachable — integration tests will be skipped.\n` +
        `[vitest] Start a database or set DATABASE_URL, then re-run.\n`,
    );
    return;
  }

  await ensureDatabaseExists(url);
  await runMigrations({ databaseUrl: url, direction: 'up' });
}
