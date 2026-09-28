import { useCallback, useEffect, useState } from 'react';
import { api, type Task, type TaskStatus } from '../api/client';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

/**
 * All server interaction lives here so components stay presentational.
 * State machine: loading -> loaded (with optional error banner).
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.list(filter);
      setTasks(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs a mutation, keeps the local list in sync, surfaces failures. */
  const run = useCallback(
    async (mutation: () => Promise<void>) => {
      setBusy(true);
      try {
        await mutation();
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Operation failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const addTask = useCallback(
    (title: string, description?: string) =>
      run(async () => {
        await api.create({ title, ...(description ? { description } : {}) });
      }),
    [run],
  );

  const cycleStatus = useCallback(
    (task: Task) =>
      run(async () => {
        await api.update(task.id, { status: NEXT_STATUS[task.status] });
      }),
    [run],
  );

  const deleteTask = useCallback(
    (task: Task) =>
      run(async () => {
        await api.remove(task.id);
      }),
    [run],
  );

  return {
    tasks,
    filter,
    loading,
    busy,
    error,
    setFilter,
    addTask,
    cycleStatus,
    deleteTask,
    retry: refresh,
  };
}
