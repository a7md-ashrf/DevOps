import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgresql://user:pass@db:5432/app' };

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is required/);
  });

  it('applies safe defaults', () => {
    const config = loadConfig({ ...BASE });
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.logFormat).toBe('pretty');
    expect(config.corsOrigins).toEqual([]);
    expect(config.trustProxy).toBe(false);
  });

  it('parses comma-separated CORS origins and trims whitespace', () => {
    const config = loadConfig({
      ...BASE,
      CORS_ORIGINS: ' https://a.example , https://b.example ,',
    });
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('enables trust proxy for 1 and true', () => {
    expect(loadConfig({ ...BASE, TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(loadConfig({ ...BASE, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...BASE, TRUST_PROXY: 'no' }).trustProxy).toBe(false);
  });

  it('rejects malformed PORT values', () => {
    expect(() => loadConfig({ ...BASE, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...BASE, PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...BASE, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('defaults log format to json outside development', () => {
    expect(loadConfig({ ...BASE, NODE_ENV: 'production' }).logFormat).toBe('json');
  });
});
