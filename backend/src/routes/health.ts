import type { Request, Response } from 'express';
import { Router } from 'express';
import type pg from 'pg';
import { ping } from '../db/pool.js';

export const healthRouter = Router();

/**
 * Liveness + dependency check in one endpoint.
 *
 * Response codes matter: Docker HEALTHCHECK and `docker compose up --wait`
 * treat 200 as healthy and anything else as failure — so a dead database
 * returns 503 and the deploy gate (see infra/deploy/deploy.sh) refuses to
 * promote the release.
 */
healthRouter.get('/', async (req: Request, res: Response) => {
  const pool = req.app.locals.pool as pg.Pool;
  const dbUp = await ping(pool);

  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    checks: { database: dbUp ? 'up' : 'down' },
    uptime_seconds: Math.floor(process.uptime()),
    version: req.app.locals.version as string,
  });
});
