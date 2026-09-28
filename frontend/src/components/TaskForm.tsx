import { useState, type FormEvent } from 'react';

interface TaskFormProps {
  busy: boolean;
  onSubmit: (title: string, description?: string) => void;
}

export function TaskForm({ busy, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') return;
    onSubmit(trimmed, description.trim() || undefined);
    // The parent refreshes from the server after the POST succeeds; clearing
    // optimistically here keeps the form responsive under slow networks.
    setTitle('');
    setDescription('');
  }

  return (
    <form className="task-form" onSubmit={handleSubmit} aria-label="Add task">
      <input
        type="text"
        name="title"
        placeholder="What needs doing?"
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        required
        autoFocus
      />
      <input
        type="text"
        name="description"
        placeholder="Details (optional)"
        value={description}
        maxLength={2000}
        onChange={(event) => setDescription(event.target.value)}
      />
      <button type="submit" disabled={busy || title.trim() === ''}>
        Add
      </button>
    </form>
  );
}
