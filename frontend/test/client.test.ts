import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /api/tasks and unwraps the envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: [], meta: { limit: 20, offset: 0, total: 0 } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await api.list();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.anything());
    expect(res.meta.total).toBe(0);
  });

  it('appends the status filter when given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: [], meta: { limit: 20, offset: 0, total: 0 } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.list('done');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks?status=done');
  });

  it('POSTs JSON with a content-type header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: 'x', title: 't', status: 'todo' } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.create({ title: 't' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/tasks');
    expect(init?.method).toBe('POST');
    expect(init?.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body)).toEqual({ title: 't' });
  });

  it('surfaces the server error envelope as ApiError', async () => {
    // mockImplementation (not mockResolvedValue) so every call gets a FRESH
    // Response — a Response body can only be read once.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          jsonResponse(400, {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Field "title" is required and must be a string',
            },
          }),
        ),
      ),
    );

    await expect(api.create({ title: '' })).rejects.toThrowError(ApiError);
    await expect(api.create({ title: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('resolves undefined on 204 (DELETE)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.remove('some-id')).resolves.toBeUndefined();
  });
});
