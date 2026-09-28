import { Router } from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { NotFoundError } from '../errors.js';
import type { Task, TaskStatus } from '../task.js';
import {
  asBody,
  optionalStatus,
  optionalString,
  pagination,
  requiredString,
  statusFilter,
  uuid,
} from '../validation.js';

export const tasksRouter = Router();

const TITLE_RULE = { min: 1, max: 200 };
const DESCRIPTION_RULE = { max: 2000 };

const COLUMNS = 'id, title, description, status, created_at, updated_at';

function poolOf(req: { app: { locals: Record<string, unknown> } }): pg.Pool {
  return req.app.locals.pool as pg.Pool;
}

/**
 * GET /api/tasks?status=&limit=&offset=
 * Every SQL statement below is parameterised ($1, $2…) — user input is NEVER
 * concatenated into SQL. The query planner still caches prepared statements,
 * so this costs nothing vs string building and eliminates SQL injection.
 */
tasksRouter.get('/', async (req: Request, res: Response) => {
  const status = statusFilter(req.query);
  const { limit, offset } = pagination(req.query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const listSql = `
    SELECT ${COLUMNS}
    FROM tasks
    ${where}
    ORDER BY created_at DESC, id
    LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const countParams = params.slice(0, params.length - 2);
  const countSql = `SELECT count(*)::int AS total FROM tasks ${where}`;

  const db = poolOf(req);
  const [rows, countResult] = await Promise.all([
    db.query<Task>(listSql, params),
    db.query<{ total: number }>(countSql, countParams),
  ]);

  res.json({
    data: rows.rows,
    meta: { limit, offset, total: countResult.rows[0]?.total ?? 0 },
  });
});

tasksRouter.get('/:id', async (req: Request, res: Response) => {
  const id = uuid(req.params.id, 'id');
  const result = await poolOf(req).query<Task>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [id]);
  const task = result.rows[0];
  if (!task) throw new NotFoundError('Task');
  res.json({ data: task });
});

tasksRouter.post('/', async (req: Request, res: Response) => {
  const body = asBody(req.body);
  const title = requiredString(body, 'title', TITLE_RULE);
  const description = optionalString(body, 'description', DESCRIPTION_RULE) ?? null;
  const status: TaskStatus = optionalStatus(body) ?? 'todo';

  const result = await poolOf(req).query<Task>(
    `INSERT INTO tasks (title, description, status)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [title, description, status],
  );
  const task = result.rows[0];
  if (!task) throw new NotFoundError('Task');
  res.header('Location', `/api/tasks/${task.id}`).status(201).json({ data: task });
});

tasksRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = uuid(req.params.id, 'id');
  const body = asBody(req.body);

  // Build the SET clause from a fixed allow-list of columns — the column
  // names come from OUR code, never from user input.
  const sets: string[] = [];
  const params: unknown[] = [];

  const title = optionalString(body, 'title', TITLE_RULE);
  if (title !== undefined) {
    params.push(title);
    sets.push(`title = $${params.length}`);
  }
  // undefined = field absent (skip), null = clear it, string = set it.
  const description = optionalString(body, 'description', DESCRIPTION_RULE);
  if (description !== undefined) {
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  const status = optionalStatus(body);
  if (status !== undefined) {
    params.push(status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) {
    // Nothing to update: report success-with-no-op only if the task exists,
    // otherwise 404 — matches PATCH semantics without a wasted UPDATE roundtrip.
    const existing = await poolOf(req).query('SELECT 1 FROM tasks WHERE id = $1', [id]);
    if (existing.rowCount === 0) throw new NotFoundError('Task');
    const current = await poolOf(req).query<Task>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [
      id,
    ]);
    res.json({ data: current.rows[0] });
    return;
  }

  params.push(id);
  const result = await poolOf(req).query<Task>(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  );
  const task = result.rows[0];
  if (!task) throw new NotFoundError('Task');
  res.json({ data: task });
});

tasksRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = uuid(req.params.id, 'id');
  const result = await poolOf(req).query('DELETE FROM tasks WHERE id = $1', [id]);
  if (result.rowCount === 0) throw new NotFoundError('Task');
  res.status(204).end();
});
