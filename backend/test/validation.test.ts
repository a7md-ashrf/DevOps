import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.js';
import {
  asBody,
  optionalStatus,
  optionalString,
  pagination,
  requiredString,
  statusFilter,
  uuid,
} from '../src/validation.js';

describe('asBody', () => {
  it('treats undefined as empty body', () => {
    expect(asBody(undefined)).toEqual({});
  });
  it('rejects arrays and primitives', () => {
    expect(() => asBody([1, 2])).toThrow(ValidationError);
    expect(() => asBody('str')).toThrow(ValidationError);
  });
});

describe('requiredString', () => {
  it('accepts and trims a valid value', () => {
    expect(requiredString({ title: '  hello  ' }, 'title', { min: 1, max: 10 })).toBe('hello');
  });
  it('rejects missing, empty and non-string values', () => {
    expect(() => requiredString({}, 'title')).toThrow(ValidationError);
    expect(() => requiredString({ title: '   ' }, 'title')).toThrow(ValidationError);
    expect(() => requiredString({ title: 42 }, 'title')).toThrow(ValidationError);
  });
  it('enforces max length', () => {
    expect(() => requiredString({ title: 'x'.repeat(201) }, 'title', { max: 200 })).toThrow(
      /at most 200/,
    );
  });
});

describe('optionalString', () => {
  it('distinguishes absent / null / value', () => {
    expect(optionalString({}, 'description')).toBeUndefined();
    expect(optionalString({ description: null }, 'description')).toBeNull();
    expect(optionalString({ description: 'd' }, 'description')).toBe('d');
  });
});

describe('statusFilter / optionalStatus', () => {
  it('accepts valid statuses', () => {
    expect(statusFilter({ status: 'in_progress' })).toBe('in_progress');
    expect(optionalStatus({ status: 'done' })).toBe('done');
  });
  it('treats empty/absent as no filter', () => {
    expect(statusFilter({})).toBeUndefined();
    expect(statusFilter({ status: '' })).toBeUndefined();
    expect(optionalStatus({})).toBeUndefined();
  });
  it('rejects unknown statuses', () => {
    expect(() => statusFilter({ status: 'nope' })).toThrow(ValidationError);
    expect(() => optionalStatus({ status: 'nope' })).toThrow(ValidationError);
  });
});

describe('uuid', () => {
  const valid = '123e4567-e89b-12d3-a456-426614174000';
  it('accepts uuid v4-ish strings', () => {
    expect(uuid(valid, 'id')).toBe(valid);
  });
  it('rejects anything else', () => {
    expect(() => uuid('not-a-uuid', 'id')).toThrow(ValidationError);
    expect(() => uuid(42, 'id')).toThrow(ValidationError);
  });
});

describe('pagination', () => {
  it('defaults to limit=20 offset=0', () => {
    expect(pagination({})).toEqual({ limit: 20, offset: 0 });
  });
  it('parses valid values', () => {
    expect(pagination({ limit: '50', offset: '10' })).toEqual({ limit: 50, offset: 10 });
  });
  it('rejects out-of-range and non-numeric values', () => {
    expect(() => pagination({ limit: '0' })).toThrow(ValidationError);
    expect(() => pagination({ limit: '101' })).toThrow(ValidationError);
    expect(() => pagination({ offset: '-1' })).toThrow(ValidationError);
    expect(() => pagination({ limit: 'abc' })).toThrow(ValidationError);
  });
});
