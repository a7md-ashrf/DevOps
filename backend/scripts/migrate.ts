/**
 * Migration CLI:  npm run migrate:up | migrate:down | migrate:create <name>
 *
 * Runs in-process under tsx so the TypeScript migration files load through
 * the same module hooks as the rest of the codebase (see src/db/migrate.ts
 * for why we call the runner programmatically).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig } from '../src/config.js';
import { loadEnvFile } from '../src/load-env.js';
import { MIGRATIONS_DIR, runMigrations, type MigrationDirection } from '../src/db/migrate.js';

const MIGRATION_TEMPLATE = `import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  // pgm.sql(...) or pgm.createTable(...) — https://ghostery.github.io/node-pg-migrate/
}

export function down(pgm: MigrationBuilder): void {
  // Must exactly reverse "up".
}
`;

function usage(): never {
  console.error('Usage: migrate <up|down|create> [migration-name]');
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFile();

  const command = process.argv[2] ?? 'up';
  const name = process.argv[3];

  if (command === 'create') {
    if (!name) usage();
    const safeName = name.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (safeName === '') usage();
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
    // 13-digit epoch-ms prefix — node-pg-migrate sorts by it.
    const file = path.join(MIGRATIONS_DIR, `${Date.now()}_${safeName}.ts`);
    writeFileSync(file, MIGRATION_TEMPLATE, 'utf8');
    console.log(`Created ${path.relative(process.cwd(), file)}`);
    return;
  }

  if (command !== 'up' && command !== 'down') usage();

  const config = loadConfig();
  const direction: MigrationDirection = command;
  const applied = await runMigrations({ databaseUrl: config.databaseUrl, direction });
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Nothing to migrate.');
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
