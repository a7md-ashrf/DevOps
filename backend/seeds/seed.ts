/**
 * Idempotent demo data. Safe to run repeatedly: rows are only inserted while
 * the table is empty, so re-running can never duplicate or mutate live data.
 *
 *   npm run seed
 */
import pg from 'pg';
import { ConfigError, loadConfig } from '../src/config.js';
import { loadEnvFile } from '../src/load-env.js';

const SEED_SQL = `
  INSERT INTO tasks (title, description, status)
  SELECT v.title, v.description, v.status
  FROM (VALUES
    ('Ship the CI pipeline', 'Lint, test and build on every pull request', 'done'),
    ('Containerize the backend', 'Multi-stage Dockerfile, non-root user', 'done'),
    ('Terminate TLS at the edge', 'Certbot webroot + automatic renewal', 'in_progress'),
    ('Write the operations runbook', 'Deploy, rollback, restore, rotate', 'todo'),
    ('Plan the monitoring stack', 'Metrics, dashboards, alert routing', 'todo')
  ) AS v(title, description, status)
  WHERE NOT EXISTS (SELECT 1 FROM tasks LIMIT 1);
`;

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const result = await pool.query(SEED_SQL);
    console.log(
      result.rowCount === 0
        ? 'Tasks table already has data — nothing to seed.'
        : `Seeded ${result.rowCount} tasks.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
