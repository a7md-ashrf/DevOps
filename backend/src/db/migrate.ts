import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';
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
 * WHY THIS IS NOT OPTIONAL: `migrations/*.ts` is loaded by node-pg-migrate via
 * a dynamic `import()` of the file path. A dynamic import goes through Node's
 * own ESM resolver, NOT through whichever tool started this process, so the
 * `.ts` files only load if EITHER
 *   (a) the ambient Node can strip types itself — true on Node >= 22.18 / 23+,
 *       false on Node 20 — or
 *   (b) a TS loader is registered as a global ESM hook.
 *
 * Without this call the behaviour silently depends on the Node version, which
 * is how migrations broke in CI: .nvmrc pins Node 20, a developer on Node 24
 * never saw it, and every DB-backed test failed with
 *   SyntaxError: Unexpected identifier 'MigrationBuilder'
 * Registering here makes the code path identical on every Node — which is what
 * the comment below always claimed, and what the callers
 * (scripts/migrate.ts, test/global-setup.ts) both depend on.
 *
 * It is idempotent and a no-op when tsx already started the process.
 */
function ensureTypeScriptLoader(): void {
  if (loaderRegistered) return;
  register();
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
