import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError, NotFoundError, PayloadTooLargeError } from '../errors.js';
import type { Logger } from '../logger.js';

/** Terminal 404: nothing matched — convert to our error shape. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

interface WireError {
  error: { code: string; message: string; details?: unknown };
}

/**
 * The single place where failures become HTTP responses.
 *
 * WHY respond here instead of throwing inside routes: Express 5 forwards
 * rejected promises from async handlers straight to this middleware, so no
 * route needs try/catch boilerplate — one choke point guarantees every error
 * (ours or unexpected) produces the same JSON envelope and never leaks
 * stack traces to clients.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) {
      // Response already streaming — the default Express handler takes over.
      return;
    }

    if (err instanceof ApiError) {
      const body: WireError = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      // 4xx are client problems: log at warn with the request id, not as errors
      // (an error-level log every time someone typos a field buries real faults).
      logger.warn({ req_id: req.id, status: err.status, code: err.code }, err.message);
      res.status(err.status).json(body);
      return;
    }

    // express.json() reports malformed bodies as SyntaxError with a `body` prop.
    if (err instanceof SyntaxError && 'body' in err) {
      logger.warn({ req_id: req.id }, 'malformed JSON body');
      res.status(400).json({
        error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' },
      } satisfies WireError);
      return;
    }

    if (
      err instanceof PayloadTooLargeError ||
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
      } satisfies WireError);
      return;
    }

    // Unexpected: full details to the logs, generic message to the client.
    logger.error({ req_id: req.id, err }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    } satisfies WireError);
  };
}
