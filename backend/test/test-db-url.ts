import pg from 'pg';

const DEFAULT_URL = 'postgresql://app:app@127.0.0.1:5432/appdb';

/**
 * The DATABASE_URL exactly as given — the database the app actually talks to.
 *
 * Used for the "is the server up?" probe in global-setup. It must NOT be the
 * derived *_test URL: on a fresh server that database does not exist yet, so
 * probing it fails, setup returns early, and the test database is then never
 * created. See global-setup.ts.
 */
export function baseDatabaseUrl(baseUrl?: string): string {
  return new URL(baseUrl ?? process.env.DATABASE_URL ?? DEFAULT_URL).toString();
}

/**
 * Tests always run against `<dbname>_test`, never the development database —
 * a `TRUNCATE` in a test can never touch dev data. The URL is derived
 * deterministically so global-setup and worker processes agree without any
 * cross-process communication.
 */
export function testDatabaseUrl(baseUrl?: string): string {
  const url = new URL(baseDatabaseUrl(baseUrl));
  const dbName = url.pathname.replace(/^\//, '') || 'appdb';
  if (!dbName.endsWith('_test')) {
    url.pathname = `/${dbName}_test`;
  }
  return url.toString();
}

/** Used to skip DB-dependent suites gracefully when PostgreSQL is not running. */
export async function isDbReachable(url: string, timeoutMs = 1_500): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    const connect = client.connect().then(
      () => true,
      () => false,
    );
    const timeout = new Promise<false>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });
    const connected = await Promise.race([connect, timeout]);
    if (!connected) return false;
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Creates the test database if it does not exist yet (no-op otherwise). */
export async function ensureDatabaseExists(url: string): Promise<void> {
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName === '') throw new Error(`DATABASE_URL has no database name: ${url}`);
  parsed.pathname = '/postgres';

  const client = new pg.Client({ connectionString: parsed.toString() });
  try {
    await client.connect();
    // Identifiers must be quoted to be safe against odd database names.
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } catch (err) {
    // 42P04 = duplicate_database — already there, which is the happy path.
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}
