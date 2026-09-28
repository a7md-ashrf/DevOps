import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { createPool } from './db/pool.js';
import { ApiError } from './errors.js';
import type { Logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/api.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
}

export function createApp({ config, logger }: AppDeps): Express {
  const app = express();

  // No "X-Powered-By": don't advertise the framework to scanners.
  app.disable('x-powered-by');
  // Trust exactly one proxy hop (Nginx) so req.ip reflects the real client —
  // otherwise every visitor shares the proxy's IP in the rate limiter.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  // Helmet sets a pile of sensible headers. CSP is the one header we DON'T
  // set here: the edge (Nginx) serves the HTML and owns the Content-Security-
  // Policy — see nginx/snippets/security-headers.conf. Two disagreeing CSPs
  // on the same response would be a debugging nightmare.
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS is only needed while the UI and API run on different origins
  // (Vite on :5173 during `make dev`). In production both come from the same
  // Nginx origin, so an empty list (default) correctly means "same-origin only".
  app.use(cors({ origin: config.corsOrigins, credentials: false, optionsSuccessStatus: 204 }));

  // Bound body size BEFORE any handler runs; oversized bodies are rejected
  // while streaming, so a huge payload never gets buffered into memory.
  app.use(express.json({ limit: '32kb' }));

  app.use(
    pinoHttp({
      logger,
      // Reuse the edge's X-Request-Id when present (Nginx's $request_id) so a
      // single browser request can be grepped across nginx access logs and
      // backend logs. Fall back to a UUID when hit directly.
      genReqId: (req) => {
        const edgeId = req.headers['x-request-id'];
        return typeof edgeId === 'string' && edgeId.length > 0 ? edgeId : randomUUID();
      },
      // Health probes fire every few seconds — logging them would drown the
      // access log in noise with zero signal.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // Second line of defense behind Nginx's limit_req (edge drops the flood
  // first; this catches anything that slips through, e.g. direct container
  // access on the Docker network). Skips /health so orchestrator probes can
  // never be rate-limited into a crash loop.
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    // Route 429s through the shared error middleware so rate limiting returns
    // the same JSON envelope as every other error.
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many requests')),
  });

  app.use('/api', apiLimiter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  // Exposed to handlers via app.locals (health check, graceful shutdown).
  app.locals.pool = createPool(config.databaseUrl);
  app.locals.version = config.version;

  return app;
}
