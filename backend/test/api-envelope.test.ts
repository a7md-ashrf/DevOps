import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, createTestApp } from './helpers.js';

/**
 * These tests never touch the database (validation rejects before any SQL),
 * so they always run — even on a laptop with no PostgreSQL.
 */
describe('API error envelope', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await closeApp(app);
  });

  it('returns 404 with the standard envelope for unknown routes', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/api/definitely-not-a-route');
  });

  it('returns 400 BAD_JSON for malformed bodies', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_JSON');
  });

  it('returns 400 VALIDATION_ERROR when title is missing', async () => {
    const res = await request(app).post('/api/tasks').send({ description: 'no title' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual({ field: 'title' });
  });

  it('rejects non-UUID path params with 400', async () => {
    const res = await request(app).get('/api/tasks/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown status filters with 400', async () => {
    const res = await request(app).get('/api/tasks?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not advertise the framework (X-Powered-By removed)', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets helmet security headers', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
