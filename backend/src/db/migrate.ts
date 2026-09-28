import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The CJS hook, NOT `tsx/esm/api`. node-pg-migrate loads each migration with
//   createRequire(resolve('_'))(filePath)
// i.e. CommonJS `require()`, inside a try/catch that rethrows as
//   "Can't get migration files: <stack>"
// An ESM loader hook cannot intercept a CJS require, so registering the esm
// variant leaves the .ts migrations unparseable. `tsx/cjs/api` installs
// require.extensions hooks, which is the one this call path goes through.
import { register as registerCjsLoader } from 'tsx/cjs/api';
import { runner as migrationRunner } from 'node-pg-migrate';

export type MigrationDirection = 'up' | 'down';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * Resolved relative to this file so the same expression works from src/ (tsx
 * during development and tests) and dist/ (compiled in the Docker image):
 *   src/db/migrate.ts  -> ../../migrations
 *   dist/db/migrate.js -> ../../migrations
 */
export const MIGRATIONS_DIR = path.resolve(currentDir, '../../migrations');

export interface RunMigrationsOptions {
  databaseUrl: string;
  direction?: MigrationDirection;
  /** How many migrations to apply. Defaults: all pending (up) / one (down). */
  count?: number;
}

let loaderRegistered = false;

/**
 * Register a TypeScript loader for the CURRENT process, once.
 *
 * WHY THIS IS NOT OPTIONAL: `migrations/*.ts` is loaded by node-pg-migrate with
 * a CJS `require()` of the file path. `require()` only understands `.ts` if a
 * loader has extended `require.extensions`, which means the code's behaviour
 * silently depends on whether the ambient process happens to have one already
 * registered:
 *   * `npm run migrate` runs under the tsx CLI, which registers one — works.
 *   * the vitest global setup does NOT — so the require fell through to
 *     Node's plain CJS loader, which cannot parse TypeScript.
 * On a modern Node the resulting error is masked, because Node >= 22.18 /
 * 23+ strips types itself; on the Node 20 that .nvmrc pins it is not masked:
 *   Can't get migration files: SyntaxError: Unexpected identifier
 *   'MigrationBuilder'
 * That is why this only ever failed in CI and never on a recent dev machine.
 *
 * Registering here makes the code path identical on every Node and under every
 * caller — which is what the comment on runMigrations has always claimed.
 * Idempotent, and a no-op when tsx is already the loader.
 */
function ensureTypeScriptLoader(): void {
  if (loaderRegistered) return;
  registerCjsLoader();
  loaderRegistered = true;
}

/**
 * Programmatic wrapper around node-pg-migrate.
 *
 * WHY a wrapper instead of shelling out to its CLI bin: the CLI loads
 * migration files through CJS `require()`, which needs a TS loader registered
 * in the child process. Running the runner in-process keeps that concern in
 * ONE place (scripts/migrate.ts and the test global setup both call this), and
 * gives CI/tests the same code path as production.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const { databaseUrl, direction = 'up', count } = options;
  ensureTypeScriptLoader();
  const applied = await migrationRunner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count: count ?? (direction === 'up' ? Number.MAX_SAFE_INTEGER : 1),
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    verbose: true,
  });
  return applied.map((migration) => migration.name);
}
