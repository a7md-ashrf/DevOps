import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../src/task.js';
import { closeApp, createTestApp, resetTasks } from './helpers.js';
import { isDbReachable, testDatabaseUrl } from './test-db-url.js';

const dbUp = await isDbReachable(testDatabaseUrl());

describe.runIf(dbUp)('tasks CRUD', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await closeApp(app);
  });
  beforeEach(async () => {
    await resetTasks(app);
  });

  async function createTask(overrides: Record<string, unknown> = {}): Promise<Task> {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Test task', description: 'body', ...overrides });
    expect(res.status).toBe(201);
    return res.body.data as Task;
  }

  it('POST creates a task with defaults', async () => {
    const task = await createTask();
    expect(task.title).toBe('Test task');
    expect(task.status).toBe('todo');
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.created_at).toBeTruthy();
  });

  it('POST sets Location header and accepts an explicit status', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Explicit', status: 'in_progress' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/tasks/${res.body.data.id}`);
    expect(res.body.data.status).toBe('in_progress');
  });

  it('POST rejects an invalid status', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x', status: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: 'status' });
  });

  it('GET list returns data + pagination meta and filters by status', async () => {
    await createTask({ title: 'A' });
    await createTask({ title: 'B', status: 'done' });

    const all = await request(app).get('/api/tasks');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta.total).toBe(2);

    const done = await request(app).get('/api/tasks?status=done');
    expect(done.body.data).toHaveLength(1);
    expect(done.body.data[0].title).toBe('B');
    expect(done.body.meta.total).toBe(1);
  });

  it('GET honors limit/offset', async () => {
    await createTask({ title: 'one' });
    await createTask({ title: 'two' });
    await createTask({ title: 'three' });

    const res = await request(app).get('/api/tasks?limit=1&offset=1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ limit: 1, offset: 1, total: 3 });
  });

  it('GET by id returns one task, or 404', async () => {
    const task = await createTask();
    const found = await request(app).get(`/api/tasks/${task.id}`);
    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(task.id);

    const missing = await request(app).get('/api/tasks/123e4567-e89b-12d3-a456-426614174000');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH updates fields and lets updated_at change', async () => {
    const task = await createTask();
    const res = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .send({ title: 'Renamed', status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed');
    expect(res.body.data.status).toBe('done');
    expect(res.body.data.updated_at >= task.updated_at).toBe(true);
  });

  it('PATCH clears description with null', async () => {
    const task = await createTask();
    const res = await request(app).patch(`/api/tasks/${task.id}`).send({ description: null });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBeNull();
  });

  it('PATCH with no updatable fields echoes the task', async () => {
    const task = await createTask();
    const res = await request(app).patch(`/api/tasks/${task.id}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(task.id);
  });

  it('PATCH 404s for unknown id', async () => {
    const res = await request(app)
      .patch('/api/tasks/123e4567-e89b-12d3-a456-426614174000')
      .send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE removes the task; repeat delete 404s', async () => {
    const task = await createTask();
    const del = await request(app).delete(`/api/tasks/${task.id}`);
    expect(del.status).toBe(204);

    const again = await request(app).delete(`/api/tasks/${task.id}`);
    expect(again.status).toBe(404);
  });
});
