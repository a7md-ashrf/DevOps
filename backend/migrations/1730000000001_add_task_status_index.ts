import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Separate migration on purpose: it demonstrates that schema changes ship as
 * an ordered chain (new file, independent deploy of just this change) and
 * that every migration is reversible.
 *
 * The composite index serves the filtered list query
 *   SELECT … FROM tasks WHERE status = $1 ORDER BY created_at DESC
 * with an index scan instead of a filter over idx_tasks_created_at.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('tasks', ['status', 'created_at'], {
    name: 'idx_tasks_status_created_at',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('tasks', ['status', 'created_at'], {
    name: 'idx_tasks_status_created_at',
  });
}
