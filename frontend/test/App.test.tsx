import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const TASKS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Write docs',
    description: 'architecture + runbook',
    status: 'todo' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Ship v1',
    description: null,
    status: 'done' as const,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

function listResponse(tasks = TASKS) {
  return Promise.resolve(
    new Response(
      JSON.stringify({ data: tasks, meta: { limit: 20, offset: 0, total: tasks.length } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => listResponse()),
    );
  });

  it('renders tasks returned by the API', async () => {
    render(<App />);
    expect(await screen.findByText('Write docs')).toBeInTheDocument();
    expect(screen.getByText('Ship v1')).toBeInTheDocument();
    expect(screen.getByText('2 tasks shown')).toBeInTheDocument();
  });

  it('creates a task through the form', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: '33333333-3333-4333-8333-333333333333',
                title: 'New task',
                description: null,
                status: 'todo',
                created_at: '2026-01-03T00:00:00Z',
                updated_at: '2026-01-03T00:00:00Z',
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return listResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('Write docs');

    fireEvent.change(screen.getByPlaceholderText('What needs doing?'), {
      target: { value: 'New task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall?.[1]?.body ?? '{}')).toEqual({ title: 'New task' });
    });
  });

  it('shows an error banner when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
