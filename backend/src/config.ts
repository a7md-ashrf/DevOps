/**
 * Configuration is loaded ONCE, validated eagerly, and injected into the app.
 *
 * WHY fail-fast here instead of reading process.env all over the codebase:
 * a container that starts with a missing DATABASE_URL should crash in the
 * first 100ms with one clear message — not produce a confusing 500 three
 * hours later on the first request that touches the database.
 */
export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  logFormat: 'json' | 'pretty';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
  version: string;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const NODE_ENVS = new Set(['development', 'test', 'production']);

/**
 * Pure function over an env-like object so unit tests can exercise every
 * branch without touching process.env.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawNodeEnv = env.NODE_ENV ?? 'development';
  if (!NODE_ENVS.has(rawNodeEnv)) {
    throw new ConfigError(
      `NODE_ENV must be one of development|test|production, got "${rawNodeEnv}"`,
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError(
      'DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/dbname). ' +
        'In Docker it is provided by docker-compose.yml; for host development copy backend/.env.example.',
    );
  }

  const logFormat = env.LOG_FORMAT ?? (rawNodeEnv === 'development' ? 'pretty' : 'json');
  if (logFormat !== 'json' && logFormat !== 'pretty') {
    throw new ConfigError(`LOG_FORMAT must be json or pretty, got "${logFormat}"`);
  }

  return {
    nodeEnv: rawNodeEnv as Config['nodeEnv'],
    logLevel: env.LOG_LEVEL ?? 'info',
    logFormat,
    port: parsePort(env.PORT, 3000),
    databaseUrl,
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    // Behind Nginx the client IP lives in X-Forwarded-For. Express must trust
    // that header or req.ip (and therefore API rate limiting) reports the
    // proxy's IP — one shared bucket for every user. See docs/architecture.md.
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    version: env.APP_VERSION ?? 'dev',
  };
}
