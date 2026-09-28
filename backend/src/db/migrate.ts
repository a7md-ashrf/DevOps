import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Programmatic wrapper around node-pg-migrate.
 *
 * WHY a wrapper instead of shelling out to its CLI bin: the CLI loads
 * migration files through CJS `require()`, which needs a TS loader registered
 * in the child process. Running the runner inside our own tsx process keeps
 * that concern in ONE place (scripts/migrate.ts and the test global setup
 * both call this), and gives CI/tests the same code path as production.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const { databaseUrl, direction = 'up', count } = options;
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
