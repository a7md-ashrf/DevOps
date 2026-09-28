import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, createTestApp } from './helpers.js';
import { isDbReachable, testDatabaseUrl } from './test-db-url.js';

const dbUp = await isDbReachable(testDatabaseUrl());

describe.runIf(dbUp)('GET /api/health', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await closeApp(app);
  });

  it('reports 200 with the database up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('up');
    expect(typeof res.body.uptime_seconds).toBe('number');
  });
});
