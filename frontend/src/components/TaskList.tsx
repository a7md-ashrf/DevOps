import type { Task } from '../api/client';
import { TaskItem } from './TaskItem';

interface TaskListProps {
  tasks: Task[];
  loading: boolean;
  busy: boolean;
  onCycleStatus: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskList({ tasks, loading, busy, onCycleStatus, onDelete }: TaskListProps) {
  if (loading) return <p className="muted">Loading tasks…</p>;
  if (tasks.length === 0) return <p className="muted">Nothing here yet.</p>;

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          busy={busy}
          onCycleStatus={onCycleStatus}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}
