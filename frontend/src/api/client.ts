/**
 * API client — the ONLY module that knows how to talk to the backend.
 *
 * WHY a relative base path ('/api'): in production Nginx serves the UI and
 * proxies /api on the SAME origin, and in dev Vite's proxy does the same.
 * A relative path means no origin needs to be compiled into the bundle, so
 * ONE image serves staging, production and localhost — no per-env rebuilds,
 * no `VITE_API_URL` drift (a classic "works locally, 404s in prod" bug).
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskListMeta {
  limit: number;
  offset: number;
  total: number;
}

interface WireError {
  error?: { code?: string; message?: string };
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const wire = (await response.json().catch(() => ({}))) as WireError;
    throw new ApiError(
      response.status,
      wire.error?.code ?? 'UNKNOWN',
      wire.error?.message ?? `Request failed with status ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  async list(status?: TaskStatus): Promise<{ data: Task[]; meta: TaskListMeta }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<{ data: Task[]; meta: TaskListMeta }>(`/tasks${query}`);
  },

  async create(input: { title: string; description?: string }): Promise<Task> {
    const res = await request<{ data: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  async update(
    id: string,
    patch: Partial<Pick<Task, 'title' | 'description' | 'status'>>,
  ): Promise<Task> {
    const res = await request<{ data: Task }>(`/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await request<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
