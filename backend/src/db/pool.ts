import pg from 'pg';

/**
 * WHY a module-level Pool factory instead of a singleton: createApp() builds
 * its own pool so tests can spin up isolated apps, while production still gets
 * exactly one pool per process (pooling across requests is the whole point —
 * opening a connection per request does not scale).
 */
export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'devops-reference-backend',
  });
}

/** Liveness probe for /api/health: bounded so a hung DB can't hang the probe. */
export async function ping(pool: pg.Pool, timeoutMs = 1_500): Promise<boolean> {
  const probe = pool.query('SELECT 1').then(
    () => true,
    () => false,
  );
  const timeout = new Promise<false>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    // Don't keep the process alive just for the probe timer.
    timer.unref();
  });
  return Promise.race([probe, timeout]);
}
