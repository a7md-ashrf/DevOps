/**
 * One error taxonomy for the whole API. Handlers throw these; a single
 * error middleware converts them to the wire format:
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 *
 * WHY a stable machine-readable `code`: clients (and log dashboards) key off
 * the code, not the human message, which may be reworded at any time.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  public constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  public constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApiError {
  public constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class PayloadTooLargeError extends ApiError {
  public constructor(message = 'Request body is too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
    this.name = 'PayloadTooLargeError';
  }
}
