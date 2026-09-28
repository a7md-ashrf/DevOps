import { ValidationError } from './errors.js';
import { TASK_STATUSES, type TaskStatus } from './task.js';

/**
 * Hand-rolled request validation.
 *
 * WHY not zod/yup: the schema surface here is tiny (two fields + query
 * params). A dependency would still be a fine choice on a bigger API — the
 * important part is that EVERYTHING crossing the trust boundary is validated
 * before it reaches SQL, and failures come back as 400 with a precise path.
 */

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;

function isPlainObject(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asBody(value: unknown): Body {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return value;
}

export interface StringRule {
  min?: number;
  max?: number;
}

export function requiredString(body: Body, field: string, rule: StringRule = {}): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`Field "${field}" is required and must be a string`, { field });
  }
  return checkedString(value, field, { ...rule, required: true });
}

/**
 * Returns: undefined = field absent, null = JSON null (means "clear this
 * field"), string = the trimmed value. Callers decide whether null is legal.
 */
export function optionalString(
  body: Body,
  field: string,
  rule: StringRule = {},
): string | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`Field "${field}" must be a string`, { field });
  }
  return checkedString(value, field, rule);
}

function checkedString(
  value: string,
  field: string,
  rule: StringRule & { required?: boolean },
): string {
  const trimmed = value.trim();
  const min = rule.min ?? (rule.required ? 1 : 0);
  const max = rule.max ?? Number.MAX_SAFE_INTEGER;
  if (trimmed.length < min) {
    throw new ValidationError(`Field "${field}" must be at least ${min} character(s)`, { field });
  }
  if (trimmed.length > max) {
    throw new ValidationError(`Field "${field}" must be at most ${max} character(s)`, { field });
  }
  return trimmed;
}

export function optionalStatus(body: Body, field = 'status'): TaskStatus | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as TaskStatus)) {
    throw new ValidationError(`Field "${field}" must be one of: ${TASK_STATUSES.join(', ')}`, {
      field,
    });
  }
  return value as TaskStatus;
}

/** Validates ?status= on list endpoints (undefined = no filter). */
export function statusFilter(query: Query): TaskStatus | undefined {
  const value = query.status;
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as TaskStatus)) {
    throw new ValidationError(`Query "status" must be one of: ${TASK_STATUSES.join(', ')}`, {
      field: 'status',
    });
  }
  return value as TaskStatus;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`"${field}" must be a valid UUID`, { field });
  }
  return value;
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function pagination(query: Query): Pagination {
  const limit = intParam(query.limit, 'limit', 1, 100, 20);
  const offset = intParam(query.offset, 'offset', 0, 1_000_000, 0);
  return { limit, offset };
}

function intParam(raw: unknown, field: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`Query "${field}" must be an integer between ${min} and ${max}`, {
      field,
    });
  }
  return value;
}
