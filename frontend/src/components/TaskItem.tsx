import type { Task, TaskStatus } from '../api/client';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

interface TaskItemProps {
  task: Task;
  busy: boolean;
  onCycleStatus: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskItem({ task, busy, onCycleStatus, onDelete }: TaskItemProps) {
  return (
    <li className={`task-item status-${task.status}`}>
      <div className="task-main">
        <span className="task-title">{task.title}</span>
        {task.description ? <p className="task-description">{task.description}</p> : null}
      </div>
      <div className="task-actions">
        <button
          type="button"
          className="status-badge"
          onClick={() => onCycleStatus(task)}
          disabled={busy}
          title="Click to advance status"
        >
          {STATUS_LABEL[task.status]}
        </button>
        <button
          type="button"
          className="delete"
          onClick={() => onDelete(task)}
          disabled={busy}
          aria-label={`Delete ${task.title}`}
        >
          ×
        </button>
      </div>
    </li>
  );
}
