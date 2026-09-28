import { TaskForm } from './components/TaskForm';
import { TaskList } from './components/TaskList';
import { useTasks } from './hooks/useTasks';
import type { TaskStatus } from './api/client';

const FILTERS: Array<{ value: TaskStatus | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export function App() {
  const {
    tasks,
    filter,
    loading,
    busy,
    error,
    setFilter,
    addTask,
    cycleStatus,
    deleteTask,
    retry,
  } = useTasks();

  return (
    <main className="app">
      <header>
        <h1>Tasks</h1>
        <p className="muted">
          React + Express + PostgreSQL behind Nginx — a reference for containerized full-stack
          deployments.
        </p>
      </header>

      <TaskForm busy={busy} onSubmit={addTask} />

      <nav className="filters" aria-label="Filter by status">
        {FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={filter === option.value ? 'active' : ''}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void retry()}>
            Retry
          </button>
        </div>
      ) : null}

      <TaskList
        tasks={tasks}
        loading={loading}
        busy={busy}
        onCycleStatus={cycleStatus}
        onDelete={deleteTask}
      />

      <footer className="muted">
        {loading ? '' : `${tasks.length} task${tasks.length === 1 ? '' : 's'} shown`}
      </footer>
    </main>
  );
}
