import { runMigrations } from '../src/db/migrate.js';
import {
  baseDatabaseUrl,
  ensureDatabaseExists,
  isDbReachable,
  testDatabaseUrl,
} from './test-db-url.js';

/**
 * Runs once per `vitest` invocation, in the main process:
 *  1. check the server is up,
 *  2. point at the dedicated *_test database (created on first run),
 *  3. apply all migrations so the schema matches the code under test.
 *
 * If PostgreSQL is unreachable we WARN and continue — unit tests still run,
 * and DB-backed suites skip themselves via `describe.runIf(...)`. Locally that
 * is the friendly behaviour you want. CI does not accept it: the workflow
 * asserts that zero tests were skipped, so a dead service container fails the
 * build instead of quietly reporting 28 passing tests and 12 that never ran.
 *
 * The reachability probe deliberately targets the BASE database, not the
 * derived *_test one. It used to probe the *_test URL, which does not exist on
 * a fresh server — so the probe failed, this function returned early, and
 * `ensureDatabaseExists` below never ran. On every clean CI container that
 * meant `tasks.test.ts` and `health.test.ts` were skipped 100% of the time, and
 * nothing noticed, because the CI skip-guard could not see vitest's coloured
 * summary. Keep the two URLs in the right order.
 */
export default async function globalSetup(): Promise<void> {
  if (!(await isDbReachable(baseDatabaseUrl()))) {
    console.warn(
      `\n[vitest] PostgreSQL unreachable — integration tests will be skipped.\n` +
        `[vitest] Start a database or set DATABASE_URL, then re-run.\n`,
    );
    return;
  }

  const url = testDatabaseUrl();
  await ensureDatabaseExists(url);
  await runMigrations({ databaseUrl: url, direction: 'up' });
}
